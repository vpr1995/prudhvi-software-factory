// `hardstop <n> "<reason>"` of the /factory script (design factory-daily-run 4.1, R-12, J4). The
// error excerpt comes from stdin. The steps run in this order, and each one is safe to run again:
//   1 labels   set needs-human, remove agent:in-progress (through the stage move, board Backlog)
//   2 push     push HEAD when the branch has a commit that is not on the base (no test guard)
//   3 patch    save the uncommitted changes and the untracked files as a patch in <n>/logs/
//   4 comment  post one ticket comment (the flag is `hardStop.commentKey` in ticket.json)
//   5 metrics  named no-op until task 5 (#100)
//   6 report   named no-op until task 2c (#107)
//   7 clear    named no-op until task 2c (#107)
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
import { pushBranch } from './factory-push.mjs';
import { loadTicket, logEvent, moveStage, runLogFile, saveTicket } from './factory-state.mjs';
import { listFolder, readOptional, writeAtomic } from './fs-io.mjs';

const EXCERPT_LINES = 40;
const NEXT = 'Next: node tooling/repo-checks/scripts/stop-gate.mjs defer "<reason>"';
const USAGE = 'Usage: hardstop <n> "<reason>"   (error excerpt on stdin)';
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

function patchText(context) {
  const tracked = diffText(context, ['HEAD', ...NOT_STATE]);
  const listed = context.git(['ls-files', '--others', '--exclude-standard', '-z', ...NOT_STATE]);
  const untracked = listed
    .split('\0')
    .filter((file) => file !== '' && !file.endsWith('/'))
    .map((file) => diffText(context, ['--no-index', '--', '/dev/null', file]));
  return [tracked, ...untracked].join('');
}

// An earlier patch with the same text is reused: a second run saves no second patch.
function findPatch(context, ticket, text) {
  const folder = logsOf(context, ticket);
  return listFolder(folder).find(
    (name) =>
      name.startsWith('hardstop-') &&
      name.endsWith('.patch') &&
      readOptional(path.join(folder, name)) === text,
  );
}

function stepPatch(context, hs) {
  const { ticket } = hs;
  const text = patchText(context);
  if (text.trim() === '') return 'nothing to save';
  const existing = findPatch(context, ticket, text);
  if (existing !== undefined) {
    hs.patch = existing;
    return `already saved: ${existing}`;
  }
  const stamp = timestamp(context.now()).replaceAll(/[-:]/g, '');
  hs.patch = `hardstop-${stamp}.patch`;
  writeAtomic(path.join(logsOf(context, ticket), hs.patch), text);
  return `saved ${hs.patch}`;
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

/** @returns {string[]} Lines of the comment. Reason and excerpt sit in code fences, so a `@name` pings nobody. */
function commentLines({ ticket, reason, excerpt, branch, patch }) {
  // Redact the whole excerpt before the cut: a key block must not lose its header to the cut.
  const clean = redactText(excerpt);
  const rows = clean.trim() === '' ? [] : clean.replace(/\s+$/, '').split('\n');
  const kept = rows.slice(-EXCERPT_LINES);
  const cut =
    rows.length > kept.length
      ? `last ${String(kept.length)} of ${String(rows.length)} lines`
      : `${String(rows.length)} lines`;
  return [
    `Hard stop on #${ticket}. Needs a human.`,
    '',
    'Reason:',
    ...fenced(redactText(reason)),
    '',
    `Branch: \`${branch}\``,
    patch === undefined
      ? 'Patch: none'
      : `Patch: \`${patch}\` (in the ticket logs of the agent machine)`,
    '',
    ...(kept.length === 0
      ? ['Error excerpt: none']
      : [`Error excerpt (${cut}):`, ...fenced(kept.join('\n'))]),
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

const STEPS = [
  { name: 'labels', run: stepLabels },
  { name: 'push', run: stepPush },
  { name: 'patch', run: stepPatch },
  { name: 'comment', run: stepComment },
  { name: 'metrics', task: '5' },
  { name: 'report', task: '2c' },
  { name: 'clear', task: '2c' },
];

function runSteps(context, hs) {
  const { ticket } = hs;
  const logFile = runLogFile(context.root);
  const failed = [];
  for (const [index, step] of STEPS.entries()) {
    const label = `step ${String(index + 1)} ${step.name}`;
    let event = 'stop';
    let detail;
    if (step.run === undefined) {
      event = 'skip';
      detail = `skipped: task ${step.task}`;
      context.print(`${label}: not built yet (task ${step.task})\n`);
    } else {
      try {
        detail = step.run(context, hs);
      } catch (error) {
        failed.push(`${String(index + 1)} ${step.name}`);
        detail = `FAILED: ${oneLine(error instanceof Error ? error.message : String(error))}`;
      }
      context.print(`${label}: ${detail}\n`);
    }
    logEvent(context, logFile, {
      ticket,
      event,
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
  if (reasonWord === undefined || reasonWord.trim() === '' || extra.length > 0) fail(USAGE);
  const excerpt = readInput(context);
  return withLock(context, () => {
    runSteps(context, { ticket, reason: oneLine(reasonWord), excerpt, patch: undefined });
    return '';
  });
}
