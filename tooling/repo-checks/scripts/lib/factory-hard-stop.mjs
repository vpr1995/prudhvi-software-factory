// `hardstop <n> "<reason>" [--detail "<text>"]` of the /factory script (design factory-daily-run 4.1, R-12, J4). The
// error excerpt comes from stdin. The steps run in this order, and each one is safe to run again:
//   1 labels   set needs-human, remove agent:in-progress (through the stage move, board Backlog)
//   2 push     push HEAD when the branch has a commit that is not on the base (no test guard)
//   3 patch    save the error excerpt and the uncommitted changes (and the untracked files as a
//              patch) in <n>/logs/. The excerpt stays on the agent machine: no GitHub comment
//              holds it, because no regex can redact free-form error text for sure (owner, 2026-11-17)
//   4 comment  post one ticket comment (the flag is `hardStop.commentKey` in ticket.json)
//   5 metrics  create or edit the `factory-metrics` comment with the outcome needs-human (R-32,
//              lib/factory-metrics.mjs). A ticket with no state has no metrics: the step says so
//   6 report   store the stop in run.json and write the run report (R-29)
//   7 clear    end the run: run.json stays, not active (R-45)
// A failed step is printed and logged, the later steps still run, and the command exits 2 at the
// end. The reason of the failure is on the step line. It opens no draft PR and starts no ticket.
import { createHash } from 'node:crypto';
import path from 'node:path';

import {
  fail,
  readInput,
  stateFolder,
  ticketNumber,
  timestamp,
  withLock,
} from './factory-base.mjs';
import { postComment, redactText } from './factory-comment.mjs';
import { metricsStep } from './factory-metrics.mjs';
import { pushBranch } from './factory-push.mjs';
import { clearForStop, recordStop } from './factory-report.mjs';
import { loadTicket, moveStage, saveTicket, writeRunLog } from './factory-state.mjs';
import { fileSize, listFolder, readOptional, writeAtomic } from './fs-io.mjs';

const EXCERPT_LINES = 40;
const MAX_UNTRACKED_BYTES = 1024 * 1024;
const FILE_MODE = 0o600;
const EXCERPT_SUFFIX = '-excerpt.txt';
const NEXT = 'Next: node tooling/repo-checks/scripts/stop-gate.mjs defer "<reason>"';
const USAGE = 'Usage: hardstop <n> "<reason>" [--detail "<text>"]   (error excerpt on stdin)';
const MAX_DETAIL_CHARS = 500;
const STATE_FOLDER = ['.claude', 'factory'].join('/');
const DIFF = [
  'diff',
  '--no-color',
  '--no-ext-diff',
  '--binary',
  '--src-prefix=a/',
  '--dst-prefix=b/',
];
// The state folder is never part of a patch, also when a repo does not ignore it.
const NOT_STATE = ['--', '.', `:(exclude)${STATE_FOLDER}`];

const folderOf = (context, ticket) => path.join(stateFolder(context.root), ticket);
const logsOf = (context, ticket) => path.join(folderOf(context, ticket), 'logs');
const oneLine = (text) => text.replaceAll(/\s*\n\s*/g, ' ').trim();

// The comment flag (step 4) is `hardStop.commentKey` in ticket.json. A ticket with no state has no
// valid ticket.json, so the flag is in <n>/hardstop.json then.
const flagFile = (context, ticket) => path.join(folderOf(context, ticket), 'hardstop.json');

function readCommentKey(context, ticket) {
  const state = loadTicket(context.root, ticket);
  if (state !== undefined) return state.hardStop?.commentKey;
  const text = readOptional(flagFile(context, ticket));
  return text === undefined ? undefined : JSON.parse(text).commentKey;
}

function writeCommentKey(context, ticket, commentKey) {
  const state = loadTicket(context.root, ticket);
  if (state === undefined) {
    writeAtomic(flagFile(context, ticket), `${JSON.stringify({ commentKey }, undefined, 2)}\n`);
    return;
  }
  saveTicket(context.root, ticket, { ...state, hardStop: { ...state.hardStop, commentKey } });
}

// Step 1

function stepLabels(context, { ticket }) {
  const state = loadTicket(context.root, ticket);
  if (state === undefined) {
    context.gh([
      'issue',
      'edit',
      ticket,
      '--add-label',
      'needs-human',
      '--remove-label',
      'agent:in-progress',
    ]);
    return 'no ticket state: labels edited directly';
  }
  if (state.stage === 'needs-human') return 'already needs-human';
  moveStage(context, ticket, 'needs-human');
  return `${state.stage} -> needs-human: +needs-human -agent:in-progress, board Backlog`;
}

// Step 2: pushBranch prints its own lines. The step keeps the last one.

function stepPush(context, { ticket }) {
  const lines = [];
  pushBranch({ ...context, print: (text) => lines.push(text) }, ticket, { forHardStop: true });
  return lines.join('').trim().split('\n').at(-1);
}

// Step 3

// `git diff --no-index` exits 1 when the files differ. That is a result, not a failure.
function diffText(context, args) {
  try {
    return context.git([...DIFF, ...args]);
  } catch (error) {
    if (error instanceof Error && 'status' in error && error.status === 1 && 'stdout' in error) {
      return String(error.stdout);
    }
    throw error;
  }
}

// An untracked file above 1 MiB stays out of the patch. Its name goes on the step line.
function patchText(context) {
  const tracked = diffText(context, ['HEAD', ...NOT_STATE]);
  const listed = context.git(['ls-files', '--others', '--exclude-standard', '-z', ...NOT_STATE]);
  const files = listed.split('\0').filter((file) => file !== '' && !file.endsWith('/'));
  const isBig = (file) => fileSize(path.join(context.root, file)) > MAX_UNTRACKED_BYTES;
  const skipped = files.filter(isBig);
  const untracked = files
    .filter((file) => !skipped.includes(file))
    .map((file) => diffText(context, ['--no-index', '--', '/dev/null', file]));
  return { text: [tracked, ...untracked].join(''), skipped };
}

const skippedNote = (skipped) =>
  skipped.length === 0
    ? ''
    : oneLine(
        `; skipped ${String(skipped.length)} ${skipped.length === 1 ? 'file' : 'files'} over 1 MiB: ${skipped.join(', ')}`,
      );

// An earlier file with the same suffix and text is reused: a second run saves no second file.
function findSaved(context, ticket, { suffix, text }) {
  const folder = logsOf(context, ticket);
  return listFolder(folder).find(
    (name) =>
      name.startsWith('hardstop-') &&
      name.endsWith(suffix) &&
      readOptional(path.join(folder, name)) === text,
  );
}

function savePatch(context, hs, stamp) {
  const { ticket } = hs;
  const { text, skipped } = patchText(context);
  const note = skippedNote(skipped);
  if (text.trim() === '') return `nothing to save${note}`;
  const existing = findSaved(context, ticket, { suffix: '.patch', text });
  if (existing !== undefined) {
    hs.patch = existing;
    return `already saved: ${existing}${note}`;
  }
  hs.patch = `hardstop-${stamp}.patch`;
  writeAtomic(path.join(logsOf(context, ticket), hs.patch), text, FILE_MODE);
  return `saved ${hs.patch}${note}`;
}

// The last lines of the excerpt, redacted. The redaction is a second layer: the text stays local.
function excerptText(excerpt) {
  // Redact the whole excerpt before the cut: a key block must not lose its header to the cut.
  const clean = redactText(excerpt);
  if (clean.trim() === '') return '';
  return `${clean.replace(/\s+$/, '').split('\n').slice(-EXCERPT_LINES).join('\n')}\n`;
}

function saveExcerpt(context, hs, stamp) {
  const text = excerptText(hs.excerpt);
  if (text === '') return 'no excerpt';
  const existing = findSaved(context, hs.ticket, { suffix: EXCERPT_SUFFIX, text });
  if (existing !== undefined) {
    hs.excerptFile = existing;
    return `excerpt already saved: ${existing}`;
  }
  hs.excerptFile = `hardstop-${stamp}${EXCERPT_SUFFIX}`;
  writeAtomic(path.join(logsOf(context, hs.ticket), hs.excerptFile), text, FILE_MODE);
  return `excerpt saved ${hs.excerptFile}`;
}

// One time stamp for the patch and the excerpt. The excerpt goes first: a failed patch keeps it.
function stepPatch(context, hs) {
  const stamp = timestamp(context.now()).replaceAll(/[-:]/g, '');
  const excerpt = saveExcerpt(context, hs, stamp);
  return `${savePatch(context, hs, stamp)}; ${excerpt}`;
}

// Step 4

function fenceFor(text) {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  return '`'.repeat(Math.max(3, longest + 1));
}

const fenced = (text) => {
  const fence = fenceFor(text);
  return [fence, text, fence];
};

// The details text: no backtick (it cannot close the fence), redacted like the excerpt, one line,
// at most 500 characters. The cut comes after the redaction: a secret must not leak by its tail.
const detailText = (detail) =>
  redactText(detail.replaceAll('`', '')).replaceAll(/\s+/g, ' ').slice(0, MAX_DETAIL_CHARS).trim();

/** @returns {string[]} Lines of the comment. The reason and the details sit in code fences, so a `@name` pings nobody. No excerpt line is in it. */
function commentLines({ ticket, reason, detail, excerptFile, branch, patch }) {
  const details = detailText(detail);
  return [
    `Hard stop on #${ticket}. Needs a human.`,
    '',
    'Reason:',
    ...fenced(redactText(reason)),
    '',
    ...(details === '' ? [] : ['Details:', ...fenced(details), '']),
    `Branch: \`${branch}\``,
    patch === undefined
      ? 'Patch: none'
      : `Patch: \`${patch}\` (in the ticket logs of the agent machine)`,
    excerptFile === undefined
      ? 'Error excerpt: none'
      : `Error excerpt: ${excerptFile} (in the ticket logs of the agent machine)`,
  ];
}

function stepComment(context, hs) {
  const { ticket, reason } = hs;
  const state = loadTicket(context.root, ticket);
  const hashed = createHash('sha256').update(redactText(reason)).digest('hex');
  // A restart of the ticket (R-51) adds 1 to resumes, so the same reason can be posted again.
  const key = `${String(state?.resumes ?? 0)}:${hashed}`;
  if (readCommentKey(context, ticket) === key) return 'already posted';
  const branch = state?.branch ?? context.git(['branch', '--show-current']).trim();
  postComment(context, { ticket }, commentLines({ ...hs, branch }).join('\n'));
  writeCommentKey(context, ticket, key);
  return 'posted';
}

// Steps 1 to 5 have run: `hs.failed` names the ones that failed.
const stepReport = (context, hs) =>
  recordStop(context, { ticket: hs.ticket, reason: hs.reason, failedSteps: hs.failed });

const STEPS = [
  { name: 'labels', run: stepLabels },
  { name: 'push', run: stepPush },
  { name: 'patch', run: stepPatch },
  { name: 'comment', run: stepComment },
  { name: 'metrics', run: (context, hs) => metricsStep(context, hs.ticket) },
  { name: 'report', run: stepReport },
  { name: 'clear', run: (context) => clearForStop(context) },
];

// A run log that cannot be written must not stop a hard stop: each log call is best effort.
function runSteps(strict, hs) {
  const context = { ...strict, bestEffortLog: true };
  const { ticket } = hs;
  const { failed } = hs;
  for (const [index, step] of STEPS.entries()) {
    const label = `step ${String(index + 1)} ${step.name}`;
    let detail;
    try {
      detail = step.run(context, hs);
    } catch (error) {
      failed.push(`${String(index + 1)} ${step.name}`);
      detail = `FAILED: ${oneLine(error instanceof Error ? error.message : String(error))}`;
    }
    context.print(`${label}: ${detail}\n`);
    writeRunLog(context, {
      ticket,
      event: 'stop',
      from: null,
      to: null,
      detail: `${label}: ${detail}`,
    });
  }
  context.print(`${NEXT}\n`);
  if (failed.length > 0) {
    fail(
      `steps failed: ${failed.join(', ')}. Fix the cause and run hardstop again: each step is safe to run again`,
    );
  }
}

/** @returns {string} Empty text: each step prints its own line. Throws FactoryError when a step failed. */
export function hardstopCommand(words, context) {
  const [ticketWord, reasonWord, ...extra] = words;
  const ticket = ticketNumber(ticketWord);
  if (reasonWord === undefined || reasonWord.trim() === '') fail(USAGE);
  // Nothing after the reason, or `--detail` and exactly one value.
  if (extra.length > 0 && (extra.length !== 2 || extra[0] !== '--detail')) fail(USAGE);
  const excerpt = readInput(context);
  return withLock(context, () => {
    runSteps(context, {
      ticket,
      reason: oneLine(reasonWord),
      detail: extra[1] ?? '',
      excerpt,
      patch: undefined,
      excerptFile: undefined,
      failed: [],
    });
    return '';
  });
}
