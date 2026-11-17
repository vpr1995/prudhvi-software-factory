// `start [<n>] [--dry-run]` of the /factory script (design factory-daily-run 4.1, 4.5; R-1 to R-4,
// R-6, R-7, R-36, R-43, R-50, R-51). `start` builds the queue in board order, applies the skip rules,
// marks the run active or adopts it, and prints the plan.
//
// Under the lock, in this order: write or adopt run.json (the run log needs it), then for each local
// ticket R-51 `applyRestart` and R-23 `reconcile`, then build the plan, log `resume` of an adopt, and
// log each skip. A failure after run.json is written puts run.json back as it was.
// `--dry-run` runs only the plan builder: all its gh calls read, it takes no lock, and it writes
// nothing. Its stages are the stored ones, because `reconcile` and `applyRestart` write.
//
// A ticket in the queue is `new` (agent:ready) or `resume` (agent:in-progress with a local
// ticket.json, R-43). Only the number and a fixed reason of a skipped ticket reach the output and
// the log: a title or a body is never printed.
import { fail, stateFolder, ticketNumber, withLock } from './factory-base.mjs';
import { applyRestart } from './factory-caps.mjs';
import {
  activeScopes,
  bodyNamesForbiddenPath,
  closedBy,
  hasAcceptance,
  hasNeedsHuman,
  labelActor,
  namesForbiddenPath,
  pathsOf,
  prDepth,
} from './factory-queue-rules.mjs';
import { parseSize, route, routingLine } from './factory-route.mjs';
import { beginRun, logAdoption } from './factory-run.mjs';
import {
  CHECK_FIELDS,
  checksGreen,
  ghJson,
  loadTicket,
  reconcile,
  writeRunLog,
} from './factory-state.mjs';
import { BOARD } from './factory.config.mjs';
import { listFolder } from './fs-io.mjs';

const READY = 'agent:ready';
const IN_PROGRESS = 'agent:in-progress';
const MAX_STACK_DEPTH = 2;
const USAGE = 'Usage: start [<n>] [--dry-run]';
const LIMIT = '1000';
const TICKET_FOLDER = /^[1-9]\d*$/;

/** @returns {{ only: number | null, dryRun: boolean }} The arguments of `start`. */
export function parseStartArguments(words) {
  let only = null;
  let dryRun = false;
  for (const word of words) {
    if (word === '--dry-run' && !dryRun) dryRun = true;
    else if (word.startsWith('-') || only !== null) fail(USAGE);
    else only = Number(ticketNumber(word));
  }
  return { only, dryRun };
}

// Rules (R-43, R-7). Each is `[reason, test(view)]`. The first test that is true skips the ticket.
// A test can call gh, so the cheap ones come first. A `resume` ticket is checked for closed only.

const isOwner = (login, owner) =>
  typeof login === 'string' && login.toLowerCase() === owner.toLowerCase();
const apiPath = (number, suffix = '') => `repos/{owner}/{repo}/issues/${String(number)}${suffix}`;

// A parent issue, or a count that is missing or not a number, skips the ticket: fail closed.
function isParent({ env, number }) {
  const issue = ghJson(env.context, ['api', apiPath(number)]);
  const total = issue.sub_issues_summary?.total;
  return typeof total !== 'number' || !Number.isFinite(total) || total > 0;
}

function addedByOther({ env, number }) {
  const pages = ghJson(env.context, ['api', apiPath(number, '/events'), '--paginate', '--slurp']);
  return !isOwner(labelActor(Array.isArray(pages) ? pages.flat() : [], READY), env.owner);
}

const CLOSED = ['issue is closed', ({ issue }) => issue.state !== 'OPEN'];
const NEW_RULES = [
  ['no agent:ready label', ({ labels }) => !labels.has(READY)],
  ['agent:in-progress with no local ticket state', ({ labels }) => labels.has(IN_PROGRESS)],
  ['needs-human label', ({ labels }) => labels.has('needs-human')],
  [
    'issue author is not the owner (R-7)',
    ({ issue, env }) => !isOwner(issue.author?.login, env.owner),
  ],
  ['[owner] in the title', ({ issue }) => issue.title.toLowerCase().includes('[owner]')],
  ['no Acceptance checkbox', ({ issue }) => !hasAcceptance(issue.body)],
  [
    'Paths: names tooling/repo-checks or .claude/settings.json',
    ({ issue }) => namesForbiddenPath(pathsOf(issue.body)) || bodyNamesForbiddenPath(issue.body),
  ],
  ['parent issue, or sub-issue count not readable', isParent],
  ['agent:ready was not added by the owner (R-7)', addedByOther],
];

// Blockers (R-6, R-36). R-42 (wait for a pending CI) belongs to `next`: here a pending CI skips.

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
    return {
      skip: `${name}: CI of PR #${String(pr.number)} is ${pending ? 'pending' : 'not green'} (R-6)`,
    };
  }
  const depth = prDepth(pr, prs) + 1;
  if (depth > MAX_STACK_DEPTH)
    return {
      skip: `${name}: stack depth ${String(depth)} is over ${String(MAX_STACK_DEPTH)} (R-6)`,
    };
  return { stack: { blocker: blocker.number, pr: pr.number, branch: pr.headRefName, depth } };
}

function blockerVerdict(env, number) {
  const blockers = ghJson(env.context, ['api', apiPath(number, '/dependencies/blocked_by')]);
  const open = blockers.filter((blocker) => blocker.state === 'open');
  if (open.length === 0) return {};
  if (open.length > 1) {
    const list = open.map((blocker) => `#${String(blocker.number)}`).join(', ');
    return { skip: `blocked by ${list}: cannot stack on more than one blocker (R-6)` };
  }
  return stackOn(env, open[0]);
}

// Plan

/** @returns {string} The routing line, predicted from the `Paths:` line of the ticket. */
function routedPasses(body, stack) {
  const changedFiles = pathsOf(body).map((file) => ({ path: file, added: 0, deleted: 0 }));
  const base = stack === undefined ? 'origin/main' : `origin/${stack.branch}`;
  return routingLine(route({ base, changedFiles, size: parseSize(body) }));
}

function judge(env, number) {
  const { context } = env;
  const ticket = String(number);
  const issue = ghJson(context, [
    'issue',
    'view',
    ticket,
    '--json',
    'state,title,body,labels,author',
  ]);
  const labels = new Set(issue.labels.map((label) => label.name));
  const local = loadTicket(context.root, ticket);
  const resume = labels.has(IN_PROGRESS) && local !== undefined;
  const view = { env, number, issue, labels };
  const rules = resume ? [CLOSED] : [CLOSED, ...NEW_RULES];
  const hit = rules.find(([, test]) => test(view));
  if (hit !== undefined) return { number, skip: hit[0] };
  const blocked = resume ? {} : blockerVerdict(env, number);
  if (blocked.skip !== undefined) return { number, skip: blocked.skip };
  return {
    number,
    kind: resume ? 'resume' : 'new',
    stage: local?.stage,
    stack: blocked.stack,
    routing: routedPasses(issue.body, blocked.stack),
  };
}

function boardOrder(context, repository) {
  const { items } = ghJson(context, [
    'project',
    'item-list',
    BOARD.number,
    '--owner',
    BOARD.owner,
    '--format',
    'json',
    '--limit',
    LIMIT,
  ]);
  return items
    .filter((item) => item.content?.type === 'Issue' && item.content.repository === repository)
    .map((item) => item.content.number);
}

const unique = (numbers) => [...new Set(numbers)];

function labelled(context, label) {
  const issues = ghJson(context, [
    'issue',
    'list',
    '--state',
    'open',
    '--label',
    label,
    '--json',
    'number',
    '--limit',
    LIMIT,
  ]);
  return issues.map((issue) => issue.number);
}

/** @returns {{ ordered: number[], offBoard: number[] }} The candidates in board order (R-1). */
function candidates(context, repository) {
  const resumable = labelled(context, IN_PROGRESS).filter(
    (number) => loadTicket(context.root, String(number)) !== undefined,
  );
  const wanted = new Set([...labelled(context, READY), ...resumable]);
  const board = boardOrder(context, repository);
  return {
    ordered: unique(board.filter((number) => wanted.has(number))),
    offBoard: [...wanted].filter((number) => !board.includes(number)),
  };
}

/**
 * Builds the queue. Only reads. The caller decides what to write.
 *
 * @param {object} context - Command context (root, gh).
 * @param {number | null} only - The ticket of `start <n>`, or null.
 * @returns {{ queue: object[], skipped: object[] }} The queue in board order, and the skips.
 */
export function buildPlan(context, only) {
  const repository = ghJson(context, ['repo', 'view', '--json', 'nameWithOwner,owner']);
  const env = { context, owner: repository.owner.login, prs: undefined };
  const { ordered, offBoard } =
    only === null
      ? candidates(context, repository.nameWithOwner)
      : { ordered: [only], offBoard: [] };
  const verdicts = ordered.map((number) => judge(env, number));
  return {
    queue: verdicts.filter((verdict) => verdict.skip === undefined),
    skipped: [
      ...verdicts.filter((verdict) => verdict.skip !== undefined),
      ...offBoard.map((number) => ({ number, skip: `${READY} but not on board ${BOARD.number}` })),
    ],
  };
}

function describe(entry, index) {
  const place = `${String(index + 1).padStart(3)}. #${String(entry.number)}`;
  const { stack } = entry;
  const how =
    entry.kind === 'resume'
      ? `resume (stage ${entry.stage})`
      : `new${stack === undefined ? '' : `, stacked on #${String(stack.blocker)} (PR #${String(stack.pr)}, branch ${stack.branch}, depth ${String(stack.depth)})`}`;
  return `${place} ${how}\n       ${entry.routing}`;
}

function formatPlan({ queue, skipped }, header) {
  const lines = [
    header,
    queue.length === 0 ? 'queue: empty' : `queue (${String(queue.length)}, board order):`,
    ...queue.map((entry, index) => describe(entry, index)),
    ...(skipped.length === 0 ? [] : [`skipped (${String(skipped.length)}):`]),
    ...skipped.map((entry) => `  #${String(entry.number)}: ${entry.skip}`),
  ];
  return `${lines.join('\n')}\n`;
}

// Start

/** @returns {string[]} The local tickets to sync with GitHub: `<n>/ticket.json` that is not `done`. */
export function localTickets(root, only) {
  const numbers =
    only === null
      ? listFolder(stateFolder(root)).filter((name) => TICKET_FOLDER.test(name))
      : [String(only)];
  return numbers.filter((ticket) => {
    const state = loadTicket(root, ticket);
    return state !== undefined && state.stage !== 'done';
  });
}

/** R-51 then R-23 for each local ticket that is not done. Writes ticket state. The caller holds the lock. */
export function syncTickets(context, only) {
  for (const ticket of localTickets(context.root, only)) {
    applyRestart(context, ticket); // R-51 first: reconcile can move a restarted ticket on
    reconcile({ ...context, ticket });
  }
}

function planAndLog(context, only, begun) {
  syncTickets(context, only);
  const plan = buildPlan(context, only);
  logAdoption(context, begun);
  for (const entry of plan.skipped) {
    writeRunLog(context, {
      ticket: entry.number,
      event: 'skip',
      from: null,
      to: null,
      detail: entry.skip,
    });
  }
  return plan;
}

// The restore can fail too. The caller still gets the original error, with the restore failure in
// its message: the original cause must not be lost.
function restoreRun(begun, error) {
  try {
    begun.undo();
  } catch (undoError) {
    if (error instanceof Error) {
      const reason = undoError instanceof Error ? undoError.message : String(undoError);
      error.message = `${error.message}; run.json restore also failed: ${reason}`;
    }
  }
}

// The ticket files that applyRestart and reconcile write are per ticket and safe to run again. A
// failure puts run.json back as it was: the start did not happen.
function startRun(context, only) {
  const begun = beginRun(context, only);
  let plan;
  try {
    plan = planAndLog(context, only, begun);
  } catch (error) {
    restoreRun(begun, error);
    throw error;
  }
  return formatPlan(
    plan,
    `run ${begun.run.runId}: ${begun.adopted ? 'adopted (resumed)' : 'started'}`,
  );
}

function checkMayStart(context) {
  if (context.runOff()) fail('FACTORY_RUN=off is set: a run does not start');
  if (!activeScopes(context.gh(['auth', 'status'])).has('project')) {
    fail('gh token has no "project" scope: run `gh auth refresh -s project`, then start again');
  }
}

/** @returns {string} The plan to print. */
export function startCommand(words, context) {
  const { only, dryRun } = parseStartArguments(words);
  checkMayStart(context);
  if (!dryRun) return withLock(context, () => startRun(context, only));
  const header =
    'dry run: nothing is written or changed. Stages are the stored ones: no reconcile.';
  return formatPlan(buildPlan(context, only), header);
}
