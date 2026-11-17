// `push <n>` of the /factory script (design factory-daily-run 4.1, R-17, R-37, R-54). It runs the
// local test guard, then `git push origin HEAD:<branch>` with no `+` and no force flag. A rejected
// push gets a fetch, a merge of the remote branch (no rebase) and one more push. Context:
//   { root, git(args) -> stdout, guard(base) -> findings, print(text), pid }
import path from 'node:path';

import { fail, parseJson, relative, stateFolder, ticketNumber, withLock } from './factory-base.mjs';
import { failureReason, hardStop } from './factory-github.mjs';
import { loadTicket } from './factory-state.mjs';
import { readOptional, writeAtomic } from './fs-io.mjs';
import { CHECK_CONFIG_MESSAGE } from './test-guard-rules.mjs';

const DEFAULT_BASE = 'origin/main';
// Letters, digits, ".", "_", "-" and "/", and no leading "-" or "+".
const BRANCH = /^[A-Za-z0-9][\w./-]*$/;
const BAD_BRANCH_PARTS = ['..', '//', '.lock/'];

/** Refuses a branch name that is not safe in `git push origin HEAD:<branch>`. */
export function checkBranch(name) {
  const bad =
    !BRANCH.test(name) ||
    BAD_BRANCH_PARTS.some((part) => `${name}/`.includes(part)) ||
    name.endsWith('/') ||
    name.endsWith('.');
  if (bad) fail(`refused branch name "${name}": use letters, digits, ".", "_", "-" and "/" only`);
}

const pushFile = (root, ticket) => path.join(stateFolder(root), ticket, 'push.json');
const findingKey = (finding) => `${finding.file}: ${finding.message}`;

function loadPushState(root, ticket) {
  const file = pushFile(root, ticket);
  const text = readOptional(file);
  if (text === undefined) return { blocked: {}, checkConfig: false };
  return parseJson(text, relative(root, file));
}

const savePushState = (root, ticket, state) =>
  writeAtomic(pushFile(root, ticket), `${JSON.stringify(state, undefined, 2)}\n`);

/** @returns {Error | undefined} The error of the git call, or undefined when it worked. */
function tryGit(context, args) {
  context.print(`git ${args.join(' ')}\n`);
  try {
    context.git(args);
    return;
  } catch (error) {
    return error;
  }
}

// R-55: a conflict aborts the merge and stops the run, with the conflict paths.
function mergeRemote(context, branch, ticket) {
  const failure = tryGit(context, ['merge', '--no-edit', 'FETCH_HEAD']);
  if (failure === undefined) return;
  const paths = context.git(['diff', '--name-only', '--diff-filter=U']).trim().split('\n');
  context.git(['merge', '--abort']);
  hardStop(
    `merge of origin/${branch} failed (${failureReason(failure)}). Merge aborted. Conflicts: ${paths.join(', ')}`,
    ticket,
  );
}

/** @returns {boolean} True when the push needed the fetch and merge. A second reject throws. */
function pushWithRecovery(context, branch, ticket) {
  const push = ['push', 'origin', `HEAD:${branch}`];
  const rejected = tryGit(context, push);
  if (rejected === undefined) return false;
  context.print(`push rejected: ${failureReason(rejected)}\n`);
  const fetchFailure = tryGit(context, ['fetch', 'origin', branch]);
  if (fetchFailure !== undefined) {
    hardStop(`fetch after a rejected push failed: ${failureReason(fetchFailure)}`, ticket);
  }
  mergeRemote(context, branch, ticket);
  const second = tryGit(context, push);
  if (second !== undefined) hardStop(`push rejected twice: ${failureReason(second)}`, ticket);
  return true;
}

// The ticket state gives the branch and the stack base (R-37). Without it: HEAD and origin/main.
function pushTarget(context, ticket) {
  const state = loadTicket(context.root, ticket);
  const current = context.git(['branch', '--show-current']).trim();
  const branch = state?.branch ?? current;
  checkBranch(branch);
  if (current !== branch) fail(`HEAD is on "${current}", but the ticket branch is "${branch}"`);
  const base = typeof state?.base === 'string' ? `origin/${state.base}` : DEFAULT_BASE;
  return { branch, base };
}

// R-17: each other finding gets one fix round. One that is still there at the next push stops the run.
function checkGuard(context, ticket, base) {
  const previous = loadPushState(context.root, ticket);
  const findings = context.guard(base);
  const blocking = findings.filter((finding) => finding.message !== CHECK_CONFIG_MESSAGE);
  const checkConfig = blocking.length < findings.length;
  const keys = blocking.map(findingKey);
  const stayed = keys.filter((key) => (previous.blocked[key] ?? 0) > 0);
  if (stayed.length > 0) {
    hardStop(`test guard finding stayed after the fix round: ${stayed.join('; ')}`, ticket);
  }
  savePushState(context.root, ticket, {
    blocked: Object.fromEntries(keys.map((key) => [key, 1])),
    checkConfig,
  });
  if (keys.length > 0) {
    const lines = blocking.map((finding) => `${finding.file}:${finding.line} ${finding.message}`);
    fail(
      `test guard blocks the push. Fix, commit, then push again (one fix round):\n${lines.join('\n')}`,
    );
  }
  if (checkConfig) {
    context.print(`#${ticket}: check config changed: risk:high, for the router and the PR body\n`);
  }
}

/** @returns {string} Empty text: each step prints its own line. */
export function pushCommand([ticketWord, ...extra], context) {
  const ticket = ticketNumber(ticketWord);
  if (extra.length > 0) fail('Usage: push <n>');
  return withLock(context, () => {
    const { branch, base } = pushTarget(context, ticket);
    checkGuard(context, ticket, base);
    const merged = pushWithRecovery(context, branch, ticket);
    context.print(`#${ticket}: pushed ${branch}${merged ? ' after fetch and merge' : ''}\n`);
    return '';
  });
}
