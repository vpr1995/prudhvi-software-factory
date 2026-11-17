// Stack logic of the /factory script (design factory-daily-run 4.1, 4.5; R-6, R-36 to R-42, R-55).
// A blocked ticket can stack on the open PR of its one open blocker. The base of a stacked ticket is
// the blocker branch: `baseRef` (lib/factory-queue-rules.mjs) reads it from `ticket.json` `base`.
//
// `blockerVerdict` is the plan: `start`, `next` and `stack plan <n>` use it. It reads only.
//   { stack: { blocker, pr, branch, depth } }   stack on the blocker branch (R-36)
//   { skip, wait? }                             skip the ticket (R-6). `wait` is the PR number of a
//                                               blocker CI that still runs: `next` waits for it (R-42)
//   {}                                          no open blocker: the base is main
// `stack plan <n>` prints the verdict and writes nothing. For a ticket that is stacked already it
// prints the stored base and the state of the blocker PR. A blocker PR that closed with no merge is
// a hard stop (R-41).
//
// `restack <n>` (R-38, R-39): merge, never rebase, and push with no force. While the blocker PR is
// open it merges the blocker branch. After that PR merged it merges `main`, ends the stack in
// `ticket.json` (`base` null, `stackedOn` stays for the metrics), then retargets the PR to main if
// needed and marks it ready. A conflict is a hard stop with the paths (R-55). The script does not run
// `verify`: it prints the command, and the agent runs it (R-38).
//
// R-40: `noteStackMerge` stores `mergedInto` in `ticket.json` when the PR of a stacked ticket merged
// into a branch other than main. The run report prints `stackMergeLine`.
import { fail, ticketNumber, withLock } from './factory-base.mjs';
import { failureReason, hardStop } from './factory-github.mjs';
import { mergeRemote, pushBranch } from './factory-push.mjs';
import { closedBy, hasNeedsHuman, isOwner, issuePath, prDepth } from './factory-queue-rules.mjs';
import {
  CHECK_FIELDS,
  checksGreen,
  ghJson,
  loadTicket,
  saveTicket,
  writeRunLog,
} from './factory-state.mjs';

const MAX_STACK_DEPTH = 2;
const LIMIT = '1000';
const MAIN = 'main';
const USAGE = 'Usage: stack plan <n>';
const VERIFY = 'node common/scripts/install-run-rush.js verify';
const SAFE_BRANCH = /^[\w./-]{1,200}$/;

// Plan (R-6, R-36, R-42)

// The list has every open PR: a stack is as deep as the whole chain, whoever owns a link.
const openPrs = (env) => {
  env.prs ??= ghJson(env.context, [
    'pr',
    'list',
    '--state',
    'open',
    '--json',
    'number,headRefName,baseRefName,body,labels,author,isCrossRepository',
    '--limit',
    LIMIT,
  ]);
  return env.prs;
};

// Only a PR of this repository by the owner is a stack base (R-7): a fork or a PR of another
// author is as if it did not exist as a base.
const isOwnerPr = (env, pr) =>
  pr.isCrossRepository === false && isOwner(pr.author?.login, env.owner);

function stackOn(env, blocker) {
  const prs = openPrs(env);
  const pr = prs.find(
    (entry) => isOwnerPr(env, entry) && closedBy(entry.body).includes(blocker.number),
  );
  const name = `blocked by #${String(blocker.number)}`;
  if (pr === undefined) return { skip: `${name}: no open PR (R-6)` };
  if (hasNeedsHuman(blocker.labels) || hasNeedsHuman(pr.labels)) {
    return { skip: `${name}: needs-human (R-6)` };
  }
  const checks = ghJson(env.context, ['pr', 'checks', String(pr.number), '--json', CHECK_FIELDS]);
  if (!checksGreen(checks)) {
    const pending = checks.some((check) => check.bucket === 'pending');
    const reason = `${name}: CI of PR #${String(pr.number)} is ${pending ? 'pending' : 'not green'} (R-6)`;
    return pending ? { skip: reason, wait: pr.number } : { skip: reason };
  }
  const depth = prDepth(pr, prs) + 1;
  if (depth > MAX_STACK_DEPTH) {
    return {
      skip: `${name}: stack depth ${String(depth)} is over ${String(MAX_STACK_DEPTH)} (R-6)`,
    };
  }
  return { stack: { blocker: blocker.number, pr: pr.number, branch: pr.headRefName, depth } };
}

/**
 * @param {{ context: object, owner: string, prs: object[] | undefined }} env - The gh context, the owner login, and the open PRs (read once).
 * @param {number} number - The ticket.
 * @returns {object} The verdict. See the header.
 */
export function blockerVerdict(env, number) {
  const blockers = ghJson(env.context, ['api', issuePath(number, '/dependencies/blocked_by')]);
  const open = blockers.filter((blocker) => blocker.state === 'open');
  if (open.length === 0) return {};
  if (open.length > 1) {
    const list = open.map((blocker) => `#${String(blocker.number)}`).join(', ');
    return { skip: `blocked by ${list}: cannot stack on more than one blocker (R-6)` };
  }
  return stackOn(env, open[0]);
}

// The blocker PR of a stacked ticket (R-41)

/**
 * @returns {'OPEN' | 'MERGED'} The state of the blocker PR. A PR that closed with no merge is a hard stop.
 */
function parentState(context, ticket, pr) {
  const { state } = ghJson(context, ['pr', 'view', String(pr), '--json', 'state']);
  if (state === 'CLOSED') {
    hardStop(
      `blocker PR #${String(pr)} closed with no merge (R-41): the stack has no base`,
      ticket,
    );
  }
  if (state !== 'OPEN' && state !== 'MERGED') {
    fail(`gh pr view ${String(pr)}: unknown state "${String(state)}"`);
  }
  return state;
}

/** R-41 for `next`: a hard stop when the blocker PR of a ticket that is still stacked closed with no merge. */
export function checkStackParent(context, ticket, state) {
  if (typeof state.base === 'string' && Number.isInteger(state.stackedOn)) {
    parentState(context, ticket, state.stackedOn);
  }
}

// stack plan

function describeVerdict(ticket, verdict) {
  const { stack } = verdict;
  if (stack !== undefined) {
    const where = `PR #${String(stack.pr)}, branch ${stack.branch}, depth ${String(stack.depth)}`;
    return `#${ticket}: stack on #${String(stack.blocker)} (${where}). base: ${stack.branch}`;
  }
  if (verdict.wait !== undefined)
    return `#${ticket}: wait for the CI of PR #${String(verdict.wait)}`;
  if (verdict.skip !== undefined) return `#${ticket}: skip: ${verdict.skip}`;
  return `#${ticket}: not stacked. base: ${MAIN}`;
}

/** @returns {string} The text to print. Reads only: no lock, no write. */
export function stackCommand(words, context) {
  const [sub, ticketWord, ...extra] = words;
  if (sub !== 'plan' || extra.length > 0) fail(USAGE);
  const ticket = ticketNumber(ticketWord);
  const state = loadTicket(context.root, ticket);
  if (Number.isInteger(state?.stackedOn)) {
    const parent = parentState(context, ticket, state.stackedOn);
    const hint =
      parent === 'MERGED' && typeof state.base === 'string' ? ` Run restack ${ticket}.` : '';
    return `#${ticket}: stacked on PR #${String(state.stackedOn)} (${parent}). base: ${state.base ?? MAIN}.${hint}\n`;
  }
  const repository = ghJson(context, ['repo', 'view', '--json', 'nameWithOwner,owner']);
  const env = { context, owner: repository.owner.login, prs: undefined };
  return `${describeVerdict(ticket, blockerVerdict(env, Number(ticket)))}\n`;
}

// restack (R-38, R-39, R-55)

// The child PR: retarget it to main if GitHub did not, then mark it ready. A PR that is ready
// already needs no call.
function readyPr(context, branch) {
  const [pr] = ghJson(context, [
    'pr',
    'list',
    '--head',
    branch,
    '--state',
    'open',
    '--json',
    'number,isDraft,baseRefName',
  ]);
  if (pr === undefined) return `no open PR for ${branch}: nothing to mark ready`;
  const number = String(pr.number);
  if (pr.baseRefName !== MAIN) context.gh(['pr', 'edit', number, '--base', MAIN]);
  if (pr.isDraft) context.gh(['pr', 'ready', number]);
  return `PR #${number} is ready for review, base ${MAIN}`;
}

function fetchBranch(context, ref, ticket) {
  context.print(`git fetch origin ${ref}\n`);
  try {
    context.git(['fetch', 'origin', ref]);
  } catch (error) {
    hardStop(`fetch of origin/${ref} failed: ${failureReason(error)}`, ticket);
  }
}

function restack(context, ticket) {
  const state = loadTicket(context.root, ticket);
  if (state === undefined || !Number.isInteger(state.stackedOn)) {
    fail(`#${ticket} is not stacked: ticket state has no stackedOn`);
  }
  if (typeof state.branch !== 'string') fail(`#${ticket}: ticket state has no branch`);
  const current = context.git(['branch', '--show-current']).trim();
  if (current !== state.branch)
    fail(`HEAD is on "${current}", but the ticket branch is "${state.branch}"`);
  const merged = parentState(context, ticket, state.stackedOn) === 'MERGED';
  if (!merged && typeof state.base !== 'string') fail(`#${ticket}: ticket state has no stack base`);
  const ref = merged ? MAIN : state.base;
  fetchBranch(context, ref, ticket);
  mergeRemote(context, ref, ticket);
  // The stack ends before the push: the test guard of the push uses origin/main from now on.
  if (merged) saveTicket(context.root, ticket, { ...state, base: null });
  pushBranch(context, ticket);
  if (merged) return `${readyPr(context, state.branch)}\n`;
  return `#${ticket}: merged ${ref} into ${state.branch}. Run verify now: ${VERIFY} (R-38)\n`;
}

/** @returns {string} The text to print. */
export function restackCommand([ticketWord, ...extra], context) {
  const ticket = ticketNumber(ticketWord);
  if (extra.length > 0) fail('Usage: restack <n>');
  return withLock(context, () => restack(context, ticket));
}

// R-40

/**
 * Stores `mergedInto` in the ticket state when the PR of a stacked ticket merged into a branch other
 * than main, and logs it. The caller holds the lock.
 */
export function noteStackMerge(context, ticket) {
  const state = loadTicket(context.root, ticket);
  if (state === undefined || typeof state.base !== 'string' || state.mergedInto !== undefined)
    return;
  if (typeof state.branch !== 'string') return;
  const prs = ghJson(context, [
    'pr',
    'list',
    '--head',
    state.branch,
    '--state',
    'merged',
    '--json',
    'number,state,baseRefName',
  ]);
  const stray = prs.find((pr) => pr.state === 'MERGED' && pr.baseRefName !== MAIN);
  if (stray === undefined) return;
  const into = SAFE_BRANCH.test(String(stray.baseRefName))
    ? stray.baseRefName
    : '(unsafe branch name)';
  saveTicket(context.root, ticket, { ...state, mergedInto: into, mergedPr: stray.number });
  writeRunLog(context, {
    ticket,
    event: 'reconcile',
    from: state.stage,
    to: state.stage,
    detail: `PR #${String(stray.number)} merged into ${into}, not main (R-40)`,
  });
}

/** @returns {string} The report line of a ticket that `noteStackMerge` marked, with the recovery step. */
export function stackMergeLine(ticket, state) {
  const into = state.mergedInto;
  return (
    `#${String(ticket)}: PR #${String(state.mergedPr)} merged into ${into}, not main. ` +
    `Recovery: the change is on ${into}. If the PR of that branch is open, the change reaches main ` +
    `when the owner merges that PR. If that PR merged already, open a new PR from ${into} to main. ` +
    'If GitHub deleted the branch, restore it from the merged PR first.'
  );
}
