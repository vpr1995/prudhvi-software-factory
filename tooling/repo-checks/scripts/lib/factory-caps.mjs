// `caps <n>` of the /factory script (design factory-daily-run 4.1, 4.3, 4.5, R-15, R-16, R-51).
// The cap counts are not stored: each call derives them from events after `restartedAt` of the
// ticket. The model does not report them.
//   failedCi       `gh run list --branch <branch>`: runs with a failed conclusion. A cancelled run
//                  is not a failed run.
//   activeMinutes  the run log lines of the ticket (every `runs/*.jsonl`): the sum of the gaps
//                  between lines, each gap capped at 10 minutes. The gap after a `wait` line with
//                  detail `start` is left out: it is a CI wait. `wait` (task 3) writes a `wait`
//                  line with detail `start` when the wait begins and one with detail `end` when it
//                  ends.
// A cap is reached at 3 failed runs or 3 hours. A count that cannot be derived makes the cap
// reached (R-16). The JSON goes to stdout. A reached cap exits 3 (a hard stop, lib/factory-github):
// the agent then runs `hardstop`.
//
// R-51: `applyRestart` sets `restartedAt`, adds 1 to `resumes`, and resets `threadReplies` to `{}`. `caps` calls it first.
// `start` (task 2c, #106) must call it too, before it moves the stage of the ticket to building.
import path from 'node:path';

import { fail, parseJson, stateFolder, ticketNumber, withLock } from './factory-base.mjs';
import { HardStopError } from './factory-github.mjs';
import { loadTicket, saveTicket } from './factory-state.mjs';
import { listFolder, readOptional } from './fs-io.mjs';

const MAX_FAILED_CI = 3;
const MAX_ACTIVE_MS = 3 * 60 * 60_000;
const MAX_GAP_MS = 10 * 60_000;
const MINUTE_MS = 60_000;
const RUN_LIST_LIMIT = '100';
export const FAILED = new Set(['failure', 'timed_out', 'startup_failure']);

const messageOf = (error) => (error instanceof Error ? error.message : String(error));
const timeOf = (text, what) => {
  const time = Date.parse(text);
  return Number.isNaN(time) ? fail(`${what}: "${String(text)}" is not a time`) : time;
};

// R-51

function labeledTimes(events, name) {
  return events
    .filter((entry) => entry?.event === 'labeled' && entry.label?.name === name)
    .map((entry) => timeOf(entry.created_at, `event of label ${name}`));
}

/**
 * R-51. When the ticket is in stage `needs-human` and GitHub shows `agent:ready` added after the
 * last `needs-human` label, sets `restartedAt` to the time of that label event and adds 1 to
 * `resumes`. Does nothing when `restartedAt` is already that time. The caller holds the lock.
 *
 * @param {object} context - Command context (root, gh).
 * @param {string} ticket - Ticket number as text.
 * @returns {object | undefined} The ticket state after the call. Undefined when there is none.
 */
export function applyRestart(context, ticket) {
  const state = loadTicket(context.root, ticket);
  if (state?.stage !== 'needs-human') return state;
  const pages = parseJson(
    context.gh(['api', `repos/{owner}/{repo}/issues/${ticket}/events`, '--paginate', '--slurp']),
    'gh api events',
  );
  const events = Array.isArray(pages) ? pages.flat() : fail('gh api events: not a list');
  const ready = Math.max(...labeledTimes(events, 'agent:ready'));
  const stopped = Math.max(...labeledTimes(events, 'needs-human'));
  // Math.max of no value is -Infinity: no event, or no needs-human event to come after.
  if (ready === -Infinity || stopped === -Infinity || ready <= stopped) return state;
  if (state.restartedAt !== null && ready <= timeOf(state.restartedAt, 'restartedAt')) return state;
  const next = {
    ...state,
    restartedAt: new Date(ready).toISOString().replace(/\.\d+Z$/, 'Z'),
    resumes: (Number.isInteger(state.resumes) ? state.resumes : 0) + 1,
    threadReplies: {}, // R-31: a restart gives each thread 3 new replies. `handledComments` stays.
  };
  saveTicket(context.root, ticket, next);
  return next;
}

// Counts

function failedCiRuns(context, state) {
  if (typeof state.branch !== 'string' || state.branch === '') fail('ticket has no branch');
  const runs = parseJson(
    context.gh([
      'run',
      'list',
      '--branch',
      state.branch,
      '--json',
      'conclusion,createdAt',
      '--limit',
      RUN_LIST_LIMIT,
    ]),
    'gh run list',
  );
  if (!Array.isArray(runs)) fail('gh run list: not a list');
  const since = state.restartedAt === null ? -Infinity : timeOf(state.restartedAt, 'restartedAt');
  return runs.filter(
    (entry) => timeOf(entry?.createdAt, 'run createdAt') > since && FAILED.has(entry.conclusion),
  ).length;
}

// A `skip` line of a ticket is a queue decision, not work. A hard-stop step line (`step <n> ...`)
// is work. Step lines are now the event `stop`: this guard serves old logs, where a step line could
// be a `skip` event.
const isTicketSkip = (entry) => entry.event === 'skip' && !String(entry.detail).startsWith('step ');

const runFolder = (context) => path.join(stateFolder(context.root), 'runs');
const runLogNames = (context) =>
  listFolder(runFolder(context)).filter((name) => name.endsWith('.jsonl'));

/** @returns {object[]} The run log lines of a ticket in time order, each with `time` in ms. Throws when there is no run log. */
export function logLines(context, ticket) {
  const folder = runFolder(context);
  const files = runLogNames(context);
  if (files.length === 0) fail('run log missing');
  return files
    .flatMap((name) => (readOptional(path.join(folder, name)) ?? '').split('\n'))
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const entry = parseJson(line, 'run log line');
      return { ...entry, time: timeOf(entry?.ts, 'run log ts') };
    })
    .filter((entry) => entry.ticket === Number(ticket) && !isTicketSkip(entry))
    .toSorted((first, second) => first.time - second.time);
}

function activeMs(context, state, ticket) {
  const since = state.restartedAt === null ? -Infinity : timeOf(state.restartedAt, 'restartedAt');
  const lines = logLines(context, ticket).filter((entry) => entry.time > since);
  let total = 0;
  for (let index = 1; index < lines.length; index += 1) {
    const before = lines[index - 1];
    const waiting = before.event === 'wait' && before.detail === 'start';
    if (!waiting) total += Math.min(Math.max(lines[index].time - before.time, 0), MAX_GAP_MS);
  }
  return total;
}

/** @returns {{ value: number | null, problem: string | undefined }} The count, or why it cannot be derived. */
function attempt(what, derive) {
  try {
    return { value: derive(), problem: undefined };
  } catch (error) {
    return { value: null, problem: `cannot derive ${what}: ${messageOf(error)}` };
  }
}

// `peek` is the read-only `status` path: no run log yet means 0 active time, not a failure. The
// writing path (`caps`) stays fail-closed: no run log is a reached cap.
function countsOf(context, ticket, { restart, peek }) {
  const state = restart.problem === undefined ? restart.value : undefined;
  const ci = attempt('failed CI runs', () =>
    failedCiRuns(context, state ?? fail('no ticket state')),
  );
  const time = attempt('active time', () => {
    const known = state ?? fail('no ticket state');
    return peek && runLogNames(context).length === 0 ? 0 : activeMs(context, known, ticket);
  });
  const problems = [restart.problem, ci.problem, time.problem].filter((text) => text !== undefined);
  const reasons = [
    ...problems,
    ...(ci.value !== null && ci.value >= MAX_FAILED_CI
      ? [`${String(ci.value)} failed CI runs (cap ${String(MAX_FAILED_CI)})`]
      : []),
    ...(time.value !== null && time.value >= MAX_ACTIVE_MS
      ? [
          `active time ${String(time.value / MINUTE_MS)} minutes (cap ${String(MAX_ACTIVE_MS / MINUTE_MS)})`,
        ]
      : []),
  ];
  return {
    failedCi: ci.value,
    activeMinutes: time.value === null ? null : Math.round((time.value / MINUTE_MS) * 10) / 10,
    reached: reasons.length > 0,
    reason: reasons.length > 0 ? reasons.join('; ') : null,
  };
}

const derive = (context, ticket) =>
  countsOf(context, ticket, {
    restart: attempt('restart', () => applyRestart(context, ticket)),
    peek: false,
  });

/**
 * Read only (`status`, R-46): the counts of `caps` with no restart (R-51) and no lock, so it writes
 * nothing. A count that cannot be derived is null with the reason in `reason`.
 *
 * @param {object} context - Command context (root, gh).
 * @param {string} ticket - Ticket number as text.
 * @returns {{ failedCi: number | null, activeMinutes: number | null, reached: boolean, reason: string | null }}
 */
export const peekCaps = (context, ticket) =>
  countsOf(context, ticket, {
    restart: attempt('ticket state', () => loadTicket(context.root, ticket)),
    peek: true,
  });

/** @returns {string} The JSON of the counts. A reached cap prints the JSON and throws HardStopError. */
export function capsCommand([ticketWord, ...extra], context) {
  const ticket = ticketNumber(ticketWord);
  if (extra.length > 0) fail('Usage: caps <n>');
  const result = withLock(context, () => derive(context, ticket));
  const text = `${JSON.stringify(result, undefined, 2)}\n`;
  if (!result.reached) return text;
  context.print(text);
  throw new HardStopError(`cap reached: ${result.reason}`, ticket);
}
