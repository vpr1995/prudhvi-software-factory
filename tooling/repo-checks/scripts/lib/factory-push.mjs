// `push <n>` of the /factory script (design factory-daily-run 4.1, R-17, R-37, R-54). It runs the
// local test guard, then `git push origin HEAD:<branch>` with no `+` and no force flag. A push that
// git rejects as non-fast-forward gets a fetch, a merge of the remote branch (no rebase), the guard
// again and one more push. Any other push failure is a hard stop. The fix-round state is the `push`
// key of `ticket.json` (design 4.3). With no `ticket.json` it lives in memory, and a warning says a
// repeated finding cannot be tracked. Context:
//   { root, git(args) -> stdout, guard(base) -> findings, print(text), pid }
import { fail, ticketNumber, withLock } from './factory-base.mjs';
import { failureReason, hardStop } from './factory-github.mjs';
import { baseRef } from './factory-queue-rules.mjs';
import { loadTicket, saveTicket } from './factory-state.mjs';
import { CHECK_CONFIG_MESSAGE } from './test-guard-rules.mjs';

const PROTECTED_BRANCHES = ['main', 'master'];
// Letters, digits, ".", "_", "-" and "/", and no leading "-", "+" or ".".
const BRANCH = /^[A-Za-z0-9][\w./-]*$/;
// git refuses a path component that starts with ".": "/." covers it.
const BAD_BRANCH_PARTS = ['..', '//', '.lock/', '/.'];
// git prints `! [rejected] HEAD -> <branch> (fetch first)` or `(non-fast-forward)`.
const NON_FAST_FORWARD = /\[rejected\].*\((?:fetch first|non-fast-forward)\)/;

/** Refuses a branch name that is not safe in `git push origin HEAD:<branch>`. */
export function checkBranch(name) {
  const bad =
    !BRANCH.test(name) ||
    BAD_BRANCH_PARTS.some((part) => `${name}/`.includes(part)) ||
    name.endsWith('/') ||
    name.endsWith('.');
  if (bad) fail(`refused branch name "${name}": use letters, digits, ".", "_", "-" and "/" only`);
}

const findingKey = (finding) => `${finding.file}: ${finding.message}`;

// The fix-round state: { state: ticket state or undefined, blocked: { key: count } }.
function loadRound(root, ticket) {
  const state = loadTicket(root, ticket);
  const blocked = state?.push?.blocked;
  const isMap = typeof blocked === 'object' && blocked !== null && !Array.isArray(blocked);
  return { state, blocked: isMap ? blocked : {} };
}

function saveRound(root, { ticket, round }, blocked) {
  round.blocked = blocked;
  if (round.state === undefined) return;
  round.state = { ...round.state, push: { blocked } };
  saveTicket(root, ticket, round.state);
}

/** @returns {{ error: Error | undefined, output: string }} The error of the git call, if any. */
function attempt(context, args) {
  context.print(`git ${args.join(' ')}\n`);
  try {
    return { error: undefined, output: context.git(args) };
  } catch (error) {
    return { error, output: '' };
  }
}

/** @returns {Error | undefined} The error of the git call, or undefined when it worked. */
const tryGit = (context, args) => attempt(context, args).error;

function isNonFastForward(error) {
  const text = error instanceof Error && 'stderr' in error ? String(error.stderr) : '';
  return NON_FAST_FORWARD.test(text);
}

// R-55: a merge that fails stops the run. The reason is the merge failure. A merge that stopped with a
// conflict is in progress (MERGE_HEAD): it is aborted, and the conflict paths are listed. A merge that
// failed before it started (a dirty tree, a hook) has no MERGE_HEAD and nothing to abort.
export function mergeRemote(context, branch, ticket) {
  const failure = tryGit(context, ['merge', '--no-edit', 'FETCH_HEAD']);
  if (failure === undefined) return;
  const reason = `merge of origin/${branch} failed (${failureReason(failure)}).`;
  const merging = tryGit(context, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']) === undefined;
  if (!merging) hardStop(reason, ticket);
  const paths = attempt(context, ['diff', '--name-only', '--diff-filter=U'])
    .output.split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const aborted = tryGit(context, ['merge', '--abort']);
  const abortText =
    aborted === undefined ? 'Merge aborted.' : `Merge abort failed: ${failureReason(aborted)}.`;
  const conflicts = paths.length > 0 ? ` Conflicts: ${paths.join(', ')}` : '';
  hardStop(`${reason} ${abortText}${conflicts}`, ticket);
}

/** @returns {boolean} True when the push needed the fetch and merge. A second failure throws. */
function pushWithRecovery(context, plan) {
  const { branch, ticket } = plan;
  const push = ['push', 'origin', `HEAD:${branch}`];
  const rejected = tryGit(context, push);
  if (rejected === undefined) return false;
  context.print(`push rejected: ${failureReason(rejected)}\n`);
  if (!isNonFastForward(rejected)) {
    hardStop(`push failed, not a non-fast-forward reject: ${failureReason(rejected)}`, ticket);
  }
  const fetchFailure = tryGit(context, ['fetch', 'origin', branch]);
  if (fetchFailure !== undefined) {
    hardStop(`fetch after a rejected push failed: ${failureReason(fetchFailure)}`, ticket);
  }
  mergeRemote(context, branch, ticket);
  checkGuard(context, plan);
  const second = tryGit(context, push);
  if (second !== undefined) hardStop(`push rejected twice: ${failureReason(second)}`, ticket);
  return true;
}

// The ticket state gives the branch and the stack base (R-37). Without it: HEAD and origin/main.
// A push to main, master or the base branch of the stack is refused.
function pushTarget(context, ticket) {
  const state = loadTicket(context.root, ticket);
  const current = context.git(['branch', '--show-current']).trim();
  const branch = state?.branch ?? current;
  checkBranch(branch);
  if (current !== branch) fail(`HEAD is on "${current}", but the ticket branch is "${branch}"`);
  const protectedNames = [
    ...PROTECTED_BRANCHES,
    ...(typeof state?.base === 'string' ? [state.base] : []),
  ];
  if (protectedNames.includes(branch)) {
    fail(
      `refused: "${branch}" is a base branch (${protectedNames.join(', ')}). Push a ticket branch`,
    );
  }
  return { branch, base: baseRef(state) };
}

// R-17: each other finding gets one fix round. A key stays when its count is above 0 and not lower
// than the stored count: no progress. Fixing 1 of 2 findings of one message is progress.
function checkGuard(context, plan) {
  const { ticket, base, round } = plan;
  if (plan.skipGuard) return;
  const findings = context.guard(base);
  const blocking = findings.filter((finding) => finding.message !== CHECK_CONFIG_MESSAGE);
  const counts = {};
  for (const finding of blocking)
    counts[findingKey(finding)] = (counts[findingKey(finding)] ?? 0) + 1;
  const stayed = Object.entries(counts).filter(([key, count]) => {
    const stored = round.blocked[key];
    return typeof stored === 'number' && stored > 0 && count >= stored;
  });
  if (stayed.length > 0) {
    const keys = stayed.map(([key]) => key).join('; ');
    hardStop(`test guard finding stayed after the fix round: ${keys}`, ticket);
  }
  saveRound(context.root, plan, counts);
  if (blocking.length > 0) {
    if (round.state === undefined) {
      context.print('warning: no ticket state: a repeated finding cannot be tracked\n');
    }
    const lines = blocking.map((finding) => `${finding.file}:${finding.line} ${finding.message}`);
    fail(
      `test guard blocks the push. Fix, commit, then push again (one fix round):\n${lines.join('\n')}`,
    );
  }
  if (blocking.length < findings.length) {
    context.print(`#${ticket}: check config changed: risk:high, for the router and the PR body\n`);
  }
}

/**
 * Pushes HEAD of the ticket branch. The caller holds the lock. The hard stop passes
 * `forHardStop`: the push then skips the local test guard (before the push and after a merge) and
 * does nothing when the branch has no commit that is not on the base (R-12 step 2). Only the
 * hard stop code sets it: no CLI flag reaches it.
 *
 * @param {object} context - Command context.
 * @param {string} ticket - Ticket number as text.
 * @param {{ forHardStop?: boolean }} [options] - Hard stop mode.
 */
export function pushBranch(context, ticket, { forHardStop = false } = {}) {
  const { branch, base } = pushTarget(context, ticket);
  if (forHardStop) {
    const ahead = Number(context.git(['rev-list', '--count', `${base}..HEAD`]).trim());
    if (ahead === 0) {
      context.print(`#${ticket}: no commit that is not on ${base}: nothing to push\n`);
      return;
    }
  }
  const plan = {
    ticket,
    branch,
    base,
    round: loadRound(context.root, ticket),
    skipGuard: forHardStop,
  };
  checkGuard(context, plan);
  const merged = pushWithRecovery(context, plan);
  context.print(`#${ticket}: pushed ${branch}${merged ? ' after fetch and merge' : ''}\n`);
}

/** @returns {string} Empty text: each step prints its own line. */
export function pushCommand([ticketWord, ...extra], context) {
  const ticket = ticketNumber(ticketWord);
  if (extra.length > 0) fail('Usage: push <n>');
  return withLock(context, () => {
    pushBranch(context, ticket);
    return '';
  });
}
