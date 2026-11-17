// The cost script of the /factory run (design factory-daily-run 4.6, R-33). It reads the Claude Code
// transcripts of the run and gives the API-equivalent cost and the turns of one ticket slice.
//
// Layout of the transcripts (Claude Code): `<transcript root>/<project folder>/<sessionId>.jsonl`
// and, for the subagents of a session, `<project folder>/<sessionId>/subagents/*.jsonl`. The
// project folder is the repo path with each character that is not a letter or a digit replaced by
// "-". The root is `~/.claude/projects` (lib/factory.config.mjs). A test gives its own root.
//
// What it opens: only the main and the subagent transcripts of the given session IDs, in the
// project folder of this repo. What it keeps from a line: the type, the time stamp, the message
// id, the model name, and four numbers (`usage`). It prints no transcript text: a warning holds a
// file name, a line number, a fixed phrase, and a model name that is a plain name.
//
// Rules:
//   - A message counts when its time stamp is in the slice, first and last bound included.
//   - Claude Code writes one line for each content block of a message. A message id counts once.
//   - A synthetic message (`<synthetic>`) has no usage and is no turn.
//   - A model with no price (lib/factory-prices.mjs) gives `cost: null` and a warning. The turns stay.
//   - A line that is not valid, a time stamp or a usage number that is not valid, a missing
//     transcript, and a bad session id give `cost: null`, `turns: null`, and a warning.
import path from 'node:path';

import { priceOf } from './factory-prices.mjs';
import { exists, listFolder, readOptional } from './fs-io.mjs';

const SESSION_ID = /^[A-Za-z0-9][\w-]{0,63}$/;

/** @returns {boolean} True when the value is a session id that is safe as a transcript name. */
export const isSessionId = (value) => typeof value === 'string' && SESSION_ID.test(value);

// A model name that is safe to print: no space, no quote, at most 64 characters.
const PLAIN_NAME = /^[A-Za-z0-9][\w.:[\]-]{0,63}$/;
const ASSISTANT_LINE = /"type"\s*:\s*"assistant"/;
const SYNTHETIC = '<synthetic>';
const MILLION = 1_000_000;
const CENTS_FACTOR = 10_000;
const TOKEN_FIELDS = new Map([
  ['input', 'input_tokens'],
  ['output', 'output_tokens'],
  ['cacheWrite', 'cache_creation_input_tokens'],
  ['cacheRead', 'cache_read_input_tokens'],
]);

/** @returns {string} The name of the project folder of a repo path. */
export const projectFolderName = (root) => root.replaceAll(/[^A-Za-z0-9]/g, '-');

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** @returns {{ tokens: object } | { problem: string }} The four token numbers of a usage object. */
function tokensOf(usage) {
  if (typeof usage !== 'object' || usage === null) return { problem: 'no usage' };
  const tokens = {};
  for (const [key, field] of TOKEN_FIELDS) {
    const value = usage[field] ?? 0;
    if (!isNumber(value)) return { problem: `usage field ${field} is not a number` };
    tokens[key] = value;
  }
  return { tokens };
}

/**
 * @param {string} line - One transcript line that holds the text "type": "assistant".
 * @param {{ from: number, to: number }} slice - Bounds in milliseconds.
 * @returns {{ skip: true } | { problem: string } | { id: string | undefined, model: string, tokens: object }}
 */
function readLine(line, slice) {
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    return { problem: 'not valid JSON' };
  }
  if (entry?.type !== 'assistant') return { skip: true };
  const time = Date.parse(entry.timestamp);
  if (Number.isNaN(time)) return { problem: 'time stamp is not valid' };
  if (time < slice.from || time > slice.to) return { skip: true };
  const { message } = entry;
  if (typeof message?.model !== 'string') return { problem: 'no model name' };
  if (message.model === SYNTHETIC) return { skip: true };
  const found = tokensOf(message.usage);
  if (found.problem !== undefined) return { problem: found.problem };
  return { id: message.id, model: message.model, tokens: found.tokens };
}

/** Reads one transcript. Adds the messages of the slice to `state.messages` and each problem to `state.problems`. */
function readTranscript({ label, file }, slice, state) {
  const lines = (readOptional(file) ?? '').split('\n');
  for (const [index, line] of lines.entries()) {
    if (!ASSISTANT_LINE.test(line)) continue;
    const found = readLine(line, slice);
    if (found.skip === true) continue;
    if (found.problem !== undefined) {
      state.problems.push(`${label} line ${String(index + 1)}: ${found.problem}`);
      continue;
    }
    // The last line of a message id wins: a streamed message can show a partial count first.
    state.messages.set(found.id ?? `${label}:${String(index)}`, found);
  }
}

/** @returns {{ label: string, file: string }[]} The main transcript and the subagent transcripts of one session. */
function transcriptsOf(folder, sessionId) {
  const subagents = path.join(folder, sessionId, 'subagents');
  return [
    { label: `${sessionId}.jsonl`, file: path.join(folder, `${sessionId}.jsonl`) },
    ...listFolder(subagents)
      .filter((name) => name.endsWith('.jsonl'))
      .toSorted()
      .map((name) => ({
        label: `${sessionId}/subagents/${name}`,
        file: path.join(subagents, name),
      })),
  ];
}

const promptOf = (tokens) => tokens.input + tokens.cacheWrite + tokens.cacheRead;

/** @returns {number} The cost of one message in US dollars, from its token numbers and prices. */
const costOf = (tokens, price) =>
  [...TOKEN_FIELDS.keys()].reduce((sum, key) => sum + (tokens[key] / MILLION) * price[key], 0);

/** @returns {{ cost: number | null, unknown: string[] }} The cost of the messages. Null with an unknown model. */
function priceMessages(messages) {
  const unknown = new Set();
  let cost = 0;
  for (const { model, tokens } of messages.values()) {
    const price = priceOf(model, promptOf(tokens));
    if (price === undefined) unknown.add(PLAIN_NAME.test(model) ? model : '<invalid name>');
    else cost += costOf(tokens, price);
  }
  return {
    cost: unknown.size > 0 ? null : Math.round(cost * CENTS_FACTOR) / CENTS_FACTOR,
    unknown: [...unknown],
  };
}

/** @returns {{ label: string, file: string }[]} The transcripts to read. A problem with a session goes to `state.problems`. */
function sessionFiles(folder, sessionIds, state) {
  if (sessionIds.length === 0) state.problems.push('run.json has no session id');
  return sessionIds.flatMap((sessionId, index) => {
    if (!isSessionId(sessionId)) {
      state.problems.push(`session id #${String(index + 1)} is not valid`);
      return [];
    }
    const files = transcriptsOf(folder, sessionId);
    if (!exists(files[0].file)) {
      state.problems.push(`transcript of session ${sessionId} not found`);
    }
    return files;
  });
}

/**
 * Reads the usage of the ticket slice.
 *
 * @param {object} context - Command context (root, transcriptRoot).
 * @param {{ sessionIds: unknown[], from: number, to: number }} input - The session IDs of the run, and the slice bounds in milliseconds.
 * @returns {{ cost: number | null, turns: number | null, warnings: string[] }} The cost in US dollars, the count of assistant messages, and the warnings.
 */
export function readCost(context, { sessionIds, from, to }) {
  const folder = path.join(context.transcriptRoot(), projectFolderName(context.root));
  const state = { messages: new Map(), problems: [] };
  for (const transcript of sessionFiles(folder, sessionIds, state)) {
    readTranscript(transcript, { from, to }, state);
  }
  const { cost, unknown } = priceMessages(state.messages);
  const warnings = [...state.problems, ...unknown.map((name) => `unknown model "${name}"`)];
  if (state.problems.length > 0) return { cost: null, turns: null, warnings };
  return { cost, turns: state.messages.size, warnings };
}
