// `metrics <n>` of the /factory script (design factory-daily-run 4.6, R-32) and step 5 of the hard
// stop (R-12). It builds the version 2 metrics of one ticket and creates the `factory-metrics`
// comment, or edits the earlier one in place. The cost and the turns come from the cost script
// (lib/factory-cost.mjs, R-33). A value that cannot be read is `null` and a warning goes to stderr:
// the comment holds numbers and names only.
//
// Where the comment goes: on the PR of the ticket, else on the issue (4.6). The earlier comment is
// found by its `factory-metrics` block in the comments of that place, and only a comment of the
// logged-in user counts (`gh api user`): the comment of another author is never edited. A version 1
// comment has no marker line and is found the same way. The edit goes through `gh api` with `--field body=@<file>`,
// the create through the shared `postComment` (a temp file, never argv).
//
// `outcome` is `needs-human` when the ticket is in the stage `needs-human` (or the hard stop says
// so), else `green`. The command refuses a ticket in `building`, `reviewing` or `ci`: it has not ended.
import path from 'node:path';

import { fail, parseJson, stateFolder, ticketNumber, withLock } from './factory-base.mjs';
import { FAILED, logLines } from './factory-caps.mjs';
import { buildComment, postComment } from './factory-comment.mjs';
import { readCost } from './factory-cost.mjs';
import { currentSession, loadRun } from './factory-run.mjs';
import { loadTicket } from './factory-state.mjs';
import { listFolder, removeFile, writeAtomic } from './fs-io.mjs';

const MARKER_LINE = '<!-- factory-agent -->';
const FENCE = '`'.repeat(3);
const METRICS_BLOCK = /^```factory-metrics$/m;
const ROUND_FILE = /^round-\d+\.json$/;
const VERSION = /^\d+\.\d+\.\d+\S*/;
const COMMENT_ID_PATH = (id) => `repos/{owner}/{repo}/issues/comments/${String(id)}`;
const RUN_LIST_LIMIT = 100;
// Run log lines have a time stamp in whole seconds: a message in the last second is in the slice.
const LAST_SECOND_MS = 999;
const SECOND_MS = 1000;
const NOT_ENDED = new Set(['building', 'reviewing', 'ci']);
const USAGE = 'Usage: metrics <n>';
const NO_USER = 'gh user not readable: a new metrics comment is made';

const positive = (value) => (Number.isInteger(value) && value > 0 ? value : null);
const count = (value) => (Number.isInteger(value) && value >= 0 ? value : 0);

/** @returns {{ first: number, last: number, stages: object } | undefined} The slice bounds and the seconds in each stage. Undefined with no run log line of the ticket. */
function sliceOf(context, ticket) {
  let lines;
  try {
    lines = logLines(context, ticket);
  } catch {
    return;
  }
  if (lines.length === 0) return;
  const first = lines[0].time;
  const last = lines.at(-1).time;
  const moves = lines.filter((line) => line.event === 'stage' && typeof line.to === 'string');
  const seconds = new Map();
  for (const [index, move] of moves.entries()) {
    const end = moves[index + 1]?.time ?? last;
    seconds.set(move.to, (seconds.get(move.to) ?? 0) + Math.round((end - move.time) / SECOND_MS));
  }
  return { first, last, stages: Object.fromEntries(seconds) };
}

/** @returns {unknown[]} The session IDs of the run in run.json, and the current session (first turn: the Stop hook has not stored it). */
function sessionIdsOf(context, warnings) {
  let ids = [];
  try {
    const stored = loadRun(context.root)?.sessionIds;
    if (Array.isArray(stored)) ids = stored;
  } catch {
    warnings.push('run.json is not readable: no session id');
  }
  const current = currentSession(context);
  return current === undefined || ids.includes(current) ? ids : [...ids, current];
}

function readUsage(context, { ticket, slice, warnings }) {
  if (slice === undefined) {
    warnings.push(`no run log line for #${ticket}: no slice, no cost`);
    return { cost: null, turns: null };
  }
  const found = readCost(context, {
    sessionIds: sessionIdsOf(context, warnings),
    from: slice.first,
    to: slice.last + LAST_SECOND_MS,
  });
  warnings.push(...found.warnings);
  return found;
}

/** @returns {object[] | undefined} The CI runs of the branch. Undefined when `gh run list` fails or gives no list. */
function runList(context, branch) {
  try {
    const runs = parseJson(
      context.gh([
        'run',
        'list',
        '--branch',
        branch,
        '--json',
        'conclusion',
        '--limit',
        String(RUN_LIST_LIMIT),
      ]),
      'gh run list',
    );
    return Array.isArray(runs) ? runs : undefined;
  } catch {
    return;
  }
}

/** @returns {{ runs: number | null, failed: number | null }} All CI runs of the branch and the failed ones. */
function ciCounts(context, state, warnings) {
  if (typeof state.branch !== 'string' || state.branch === '') {
    warnings.push('ticket has no branch: no CI count');
    return { runs: null, failed: null };
  }
  const runs = runList(context, state.branch);
  if (runs === undefined) {
    // An error text is not printed: it can hold anything of the host.
    warnings.push('CI runs not readable: no CI count');
    return { runs: null, failed: null };
  }
  if (runs.length >= RUN_LIST_LIMIT) warnings.push(`CI run list is capped at ${RUN_LIST_LIMIT}`);
  return {
    runs: runs.length,
    failed: runs.filter((entry) => FAILED.has(entry?.conclusion)).length,
  };
}

/** @returns {string | null} The Claude Code version, or null (and a warning) when `claude --version` fails. */
function claudeVersion(context, warnings) {
  try {
    return VERSION.exec(context.claudeVersion().trim())?.[0] ?? null;
  } catch {
    // An error text is not printed: it can hold anything of the host.
    warnings.push('claude version not readable');
    return null;
  }
}

const reviewRounds = (context, ticket) =>
  listFolder(path.join(stateFolder(context.root), ticket, 'pre-pr')).filter((name) =>
    ROUND_FILE.test(name),
  ).length;

/** @returns {object} The version 2 metrics. The keys with "_" come from a list: the lint naming rule. */
function buildMetrics(context, { ticket, state, outcome, warnings }) {
  const slice = sliceOf(context, ticket);
  const usage = readUsage(context, { ticket, slice, warnings });
  const ci = ciCounts(context, state, warnings);
  const passes = Array.isArray(state.routing?.passes) ? state.routing.passes : [];
  return Object.fromEntries([
    ['v', 2],
    ['issue', Number(ticket)],
    ['pr', positive(state.pr)],
    ['cost', usage.cost],
    ['turns', usage.turns],
    ['review_rounds', reviewRounds(context, ticket)],
    ['ci_rounds', ci.failed],
    ['outcome', outcome],
    ['stages', slice?.stages ?? {}],
    ['reviewers', passes.map((pass) => pass?.name).filter((name) => typeof name === 'string')],
    ['over_budget', state.routing?.overBudget === true],
    ['decisions', count(state.decisions)],
    ['stacked_on', positive(state.stackedOn)],
    ['resumes', count(state.resumes)],
    ['ci_runs', ci.runs],
    ['claude_code', claudeVersion(context, warnings)],
  ]);
}

/** @returns {string} The login of the user of `gh`. Empty when it cannot be read: then no comment matches. */
function loginOf(context, warnings) {
  try {
    const login = context.gh(['api', 'user', '--jq', '.login']).trim();
    if (login === '') warnings.push(NO_USER);
    return login;
  } catch {
    // An error text is not printed: it can hold anything of the host.
    warnings.push(NO_USER);
    return '';
  }
}

// A comment of the factory starts with the marker line. A version 1 comment has no marker line.
const isOwnMetrics = (entry, login) =>
  login !== '' &&
  entry?.user?.login === login &&
  typeof entry.body === 'string' &&
  METRICS_BLOCK.test(entry.body) &&
  (entry.body.startsWith(MARKER_LINE) || !entry.body.includes(MARKER_LINE));

/** @returns {number | undefined} The id of the last comment of the place with a `factory-metrics` block from the logged-in user. */
function findComment(context, target, warnings) {
  const login = loginOf(context, warnings);
  const pages = parseJson(
    context.gh(['api', `repos/{owner}/{repo}/issues/${target}/comments`, '--paginate', '--slurp']),
    'gh api comments',
  );
  if (!Array.isArray(pages)) fail('gh api comments: not a list');
  const found = pages
    .flat()
    .filter((entry) => isOwnMetrics(entry, login))
    .at(-1);
  return Number.isInteger(found?.id) ? found.id : undefined;
}

function editComment(context, { ticket, id }, body) {
  const file = path.join(
    stateFolder(context.root),
    ticket,
    'logs',
    `comment-${String(context.pid)}.md`,
  );
  writeAtomic(file, buildComment(body));
  try {
    context.gh(['api', COMMENT_ID_PATH(id), '--method', 'PATCH', '--field', `body=@${file}`]);
  } finally {
    removeFile(file);
  }
}

/**
 * Creates or edits the metrics comment. The caller holds the lock.
 *
 * @param {object} context - Command context (root, gh, pid, claudeVersion, transcriptRoot).
 * @param {{ ticket: string, outcome?: string }} target - The ticket, and the outcome. With no outcome it comes from the stage.
 * @returns {{ action: string, where: string, metrics: object, warnings: string[] }} What it did.
 */
export function postMetrics(context, { ticket, outcome }) {
  const state = loadTicket(context.root, ticket) ?? fail(`#${ticket} has no ticket state`);
  const warnings = [];
  const metrics = buildMetrics(context, {
    ticket,
    state,
    outcome: outcome ?? (state.stage === 'needs-human' ? 'needs-human' : 'green'),
    warnings,
  });
  const body = `${MARKER_LINE}\n${FENCE}factory-metrics\n${JSON.stringify(metrics)}\n${FENCE}\n`;
  const pr = positive(state.pr);
  const place = pr === null ? ticket : String(pr);
  const id = findComment(context, place, warnings);
  if (id === undefined) postComment(context, { ticket, pr: pr === null ? undefined : place }, body);
  else editComment(context, { ticket, id }, body);
  return {
    action: id === undefined ? 'created' : 'edited',
    where: pr === null ? 'the issue' : `PR #${place}`,
    metrics,
    warnings,
  };
}

/**
 * Step 5 of the hard stop (R-12). The caller holds the lock. A ticket with no state has no metrics:
 * the step line says so.
 *
 * @returns {string} The detail of the step line.
 */
export function metricsStep(context, ticket) {
  if (loadTicket(context.root, ticket) === undefined) return 'skipped: no ticket state';
  const { action, where, warnings } = postMetrics(context, { ticket, outcome: 'needs-human' });
  return [`${action} on ${where}`, ...warnings.map((warning) => `warning: ${warning}`)].join('; ');
}

/** @returns {string} The line to print. The warnings go to stderr. */
export function metricsCommand([ticketWord, ...extra], context) {
  const ticket = ticketNumber(ticketWord);
  if (extra.length > 0) fail(USAGE);
  return withLock(context, () => {
    const stage = loadTicket(context.root, ticket)?.stage;
    if (stage === undefined) fail(`#${ticket} has no ticket state`);
    if (NOT_ENDED.has(stage)) {
      fail(
        `#${ticket} is in stage ${stage}: it has not ended. Run metrics at green, or after a hard stop`,
      );
    }
    const { action, where, metrics, warnings } = postMetrics(context, { ticket });
    for (const warning of warnings) context.err(`warning: ${warning}\n`);
    return `#${ticket}: metrics comment ${action} on ${where} (cost ${String(metrics.cost)}, turns ${String(metrics.turns)})\n`;
  });
}
