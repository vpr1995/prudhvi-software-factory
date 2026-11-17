// State of the /factory run (design factory-daily-run 4.3 and 4.4). It is the only code that
// reads and writes `.claude/factory/` (R-25). Each command takes a context:
//   { root, gh(args) -> stdout, git(args) -> stdout, now() -> Date, pid, stdin() -> text, print(text) }
// Refusals throw FactoryError. The caller prints the message and exits non-zero.
import path from 'node:path';

import {
  AD_HOC,
  FactoryError,
  fail,
  parseJson,
  plainName,
  PRE_PR,
  readInput,
  relative,
  stateFolder,
  ticketNumber,
  timestamp,
  withLock,
} from './factory-base.mjs';
import { listFindings, findingsCommand, roundCommand } from './factory-findings.mjs';
import { BOARD } from './factory.config.mjs';
import { appendText, readOptional, writeAtomic } from './fs-io.mjs';

export { FactoryError };

const ENTRY_STAGE = 'building';
const RUN_ID = /^[A-Za-z0-9][\w.-]*$/;
const SUMMARY_HEADING = '## Summary';
const MIN_BULLETS = 3;
const MAX_BULLETS = 5;

const IN_PROGRESS_LABELS = { add: ['agent:in-progress'], remove: ['agent:ready'] };
const NO_LABELS = { add: [], remove: [] };
// The owner added `agent:ready` and GitHub gives no stage (R-57). It is not a stage.
const READY = 'ready';
const READY_STATUS = 'Ready';

/** Stages of design 4.4: labels on entry, board Status, legal next stages. */
export const STAGES = new Map(
  Object.entries({
    building: {
      labels: IN_PROGRESS_LABELS,
      status: 'In progress',
      next: ['reviewing', 'needs-human'],
    },
    reviewing: {
      labels: NO_LABELS,
      status: 'In progress',
      next: ['building', 'ci', 'needs-human'],
    },
    ci: { labels: NO_LABELS, status: 'In review', next: ['building', 'green', 'needs-human'] },
    green: {
      labels: { add: [], remove: ['agent:in-progress'] },
      status: 'In review',
      next: ['building', 'done', 'needs-human'],
    },
    'needs-human': {
      labels: { add: ['needs-human'], remove: ['agent:in-progress'] },
      status: 'Backlog',
      next: ['building'],
    },
    done: { labels: NO_LABELS, status: 'Done', next: [] },
  }),
);

// Run log (R-28)

export function runLogFile(root) {
  const text = readOptional(path.join(stateFolder(root), 'run.json'));
  if (text === undefined) return path.join(stateFolder(root), 'runs', `${AD_HOC}.jsonl`);
  const log = parseJson(text, 'run.json');
  if (typeof log !== 'object' || log === null) fail('run.json: must be a JSON object');
  const { runId } = log;
  if (typeof runId !== 'string' || !RUN_ID.test(runId))
    fail('run.json: runId must be a plain name');
  return path.join(stateFolder(root), 'runs', `${runId}.jsonl`);
}

export function logEvent(context, logFile, { ticket, event, from, to, detail }) {
  const line = { ts: timestamp(context.now()), ticket: Number(ticket), event, from, to, detail };
  appendText(logFile, `${JSON.stringify(line)}\n`);
}

/**
 * Writes one run log line. With `context.bestEffortLog` a failure is printed as `log failed: <reason>`
 * and the caller goes on. Without it the failure is thrown.
 */
export function writeRunLog(context, entry) {
  try {
    logEvent(context, runLogFile(context.root), entry);
  } catch (error) {
    if (context.bestEffortLog !== true) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    context.print(`log failed: ${reason.replaceAll(/\s*\n\s*/g, ' ').trim()}\n`);
  }
}

// Ticket state

const ticketFile = (root, ticket) => path.join(stateFolder(root), ticket, 'ticket.json');

export function loadTicket(root, ticket) {
  const file = ticketFile(root, ticket);
  const text = readOptional(file);
  if (text === undefined) return;
  const state = parseJson(text, relative(root, file));
  if (!STAGES.has(state?.stage)) {
    fail(`${relative(root, file)}: stage must be one of ${[...STAGES.keys()].join(', ')}`);
  }
  return state;
}

export function saveTicket(root, ticket, state) {
  writeAtomic(ticketFile(root, ticket), `${JSON.stringify(state, undefined, 2)}\n`);
}

function newTicket(context, ticket, stage) {
  const branch = context.git(['branch', '--show-current']).trim();
  return {
    issue: Number(ticket),
    stage,
    branch: branch === '' ? null : branch,
    base: null,
    pr: null,
    stackedOn: null,
    restartedAt: null,
    threadReplies: {},
    handledComments: [],
    decisions: 0,
    resumes: 0,
    routing: {},
  };
}

/** @returns {boolean} True when a cancelled check has a later pass in the same workflow. */
function supersededCancel(check, checks) {
  const { workflow, startedAt } = check;
  if (typeof workflow !== 'string' || typeof startedAt !== 'string') return false;
  return checks.some(
    (other) =>
      other.bucket === 'pass' &&
      other.workflow === workflow &&
      typeof other.startedAt === 'string' &&
      other.startedAt > startedAt,
  );
}

/**
 * A cancelled duplicate run (same workflow, earlier start) does not block.
 * @returns {boolean} True when a CI check list has a pass and no check that fails or runs.
 */
export function checksGreen(checks) {
  const okay = (check) =>
    check.bucket === 'pass' ||
    check.bucket === 'skipping' ||
    (check.bucket === 'cancel' && supersededCancel(check, checks));
  return checks.some((check) => check.bucket === 'pass') && checks.every(okay);
}

/** The --json field list for `gh pr checks`. */
export const CHECK_FIELDS = 'name,state,bucket,startedAt,workflow';

// GitHub: labels and board Status (R-57)

export function ghJson(context, args) {
  return parseJson(context.gh(args), `gh ${args.slice(0, 2).join(' ')}`);
}

function repository(context) {
  const name = context
    .gh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'])
    .trim();
  return name === '' ? fail('gh gave no repository name (gh repo view)') : name;
}

function boardItem(context, ticket) {
  const { items } = ghJson(context, [
    'project',
    'item-list',
    BOARD.number,
    '--owner',
    BOARD.owner,
    '--format',
    'json',
    '--limit',
    '1000',
  ]);
  const own = repository(context);
  return items.find(
    (entry) => entry.content?.number === Number(ticket) && entry.content?.repository === own,
  );
}

// Read-only lookups. Returns the arguments of the item-edit call, so a refusal comes before any write.
function boardEdit(context, ticket, status) {
  const board = ['--owner', BOARD.owner];
  const { fields } = ghJson(context, [
    'project',
    'field-list',
    BOARD.number,
    ...board,
    '--format',
    'json',
  ]);
  const field = fields.find((entry) => entry.name === BOARD.statusField);
  const option = field?.options?.find((entry) => entry.name === status);
  if (option === undefined) {
    fail(`board ${BOARD.number}: ${BOARD.statusField} option "${status}" not found`);
  }
  const item = boardItem(context, ticket);
  if (item === undefined) fail(`ticket #${ticket} is not on board ${BOARD.number}`);
  const project = ghJson(context, ['project', 'view', BOARD.number, ...board, '--format', 'json']);
  return [
    'project',
    'item-edit',
    '--id',
    item.id,
    '--field-id',
    field.id,
    '--project-id',
    project.id,
    '--single-select-option-id',
    option.id,
  ];
}

function moveLabels(context, ticket, { add, remove }) {
  if (add.length === 0 && remove.length === 0) return;
  context.gh([
    'issue',
    'edit',
    ticket,
    ...add.flatMap((label) => ['--add-label', label]),
    ...remove.flatMap((label) => ['--remove-label', label]),
  ]);
}

// stage (R-14, R-24, R-28, R-57)

function checkLegal(from, to) {
  if (from === undefined) {
    if (to !== ENTRY_STAGE) {
      fail(`illegal stage move: none -> ${to}. Ticket has no state: it starts at "${ENTRY_STAGE}"`);
    }
    return;
  }
  const legal = STAGES.get(from).next;
  if (!legal.includes(to)) {
    fail(
      `illegal stage move: ${from} -> ${to}. Legal next stages of ${from}: ${legal.join(', ') || 'none'}`,
    );
  }
}

/**
 * Moves the stage of a ticket: board and labels first, then the state and the run log. The caller
 * holds the lock.
 *
 * @param {object} context - Command context.
 * @param {string} ticket - Ticket number as text.
 * @param {string} to - Name of the target stage.
 * @returns {string} The line to print.
 */
export function moveStage(context, ticket, to) {
  const target =
    STAGES.get(to) ??
    fail(`unknown stage "${String(to)}". Stages: ${[...STAGES.keys()].join(', ')}`);
  // A run log that cannot be read refuses the move before any change, unless the caller logs best effort.
  if (context.bestEffortLog !== true) runLogFile(context.root);
  const state = loadTicket(context.root, ticket);
  checkLegal(state?.stage, to);
  const boardArguments = boardEdit(context, ticket, target.status);
  moveLabels(context, ticket, target.labels);
  context.gh(boardArguments);
  saveTicket(context.root, ticket, { ...(state ?? newTicket(context, ticket, to)), stage: to });
  const labels = [
    ...target.labels.add.map((label) => `+${label}`),
    ...target.labels.remove.map((label) => `-${label}`),
  ];
  const detail = [
    ...(labels.length > 0 ? [`labels ${labels.join(' ')}`] : []),
    `board ${target.status}`,
  ];
  writeRunLog(context, {
    ticket,
    event: 'stage',
    from: state?.stage ?? null,
    to,
    detail: detail.join('; '),
  });
  return `#${ticket}: ${state?.stage ?? 'none'} -> ${to}\n`;
}

function stageCommand([ticketWord, to], context) {
  const ticket = ticketNumber(ticketWord);
  return withLock(context, () => moveStage(context, ticket, to));
}

// reconcile (R-23). `start` (lib/factory-queue.mjs) calls it and holds the lock.

function githubStage(context, ticket, state) {
  const { labels } = ghJson(context, ['issue', 'view', ticket, '--json', 'labels']);
  const prs =
    state.branch === null
      ? []
      : ghJson(context, [
          'pr',
          'list',
          '--head',
          state.branch,
          '--state',
          'all',
          '--json',
          'number,state',
        ]);
  if (prs.some((pr) => pr.state === 'MERGED')) return 'done';
  if (labels.some((label) => label.name === 'needs-human')) return 'needs-human';
  const open = prs.find((pr) => pr.state === 'OPEN');
  if (open === undefined) {
    return labels.some((label) => label.name === 'agent:ready') ? READY : undefined;
  }
  const checks = ghJson(context, ['pr', 'checks', String(open.number), '--json', CHECK_FIELDS]);
  return checksGreen(checks) ? 'green' : 'ci';
}

// R-57: `agent:ready` with no stage matches board Status Ready. On a mismatch, prints both values and
// logs it. It writes no board value and changes no stage: the claim (`stage building`) moves both.
function reconcileReady(context, ticket, state) {
  const board = boardItem(context, ticket)?.status ?? 'none';
  if (board === READY_STATUS) return state.stage;
  context.print(`reconcile #${ticket}: board=${board} github=${READY_STATUS}; using github\n`);
  logEvent(context, runLogFile(context.root), {
    ticket,
    event: 'reconcile',
    from: state.stage,
    to: state.stage,
    detail: `github: board ${board}, expected ${READY_STATUS}`,
  });
  return state.stage;
}

/**
 * Derives the stage of a ticket from GitHub (design 4.4 order). On a mismatch with the stored
 * stage, prints both values, stores the GitHub stage and logs a `reconcile` event.
 *
 * @param {object} context - Command context, plus `ticket` (the number as text).
 * @returns {string | undefined} The stage to use. Undefined when the ticket has no local state.
 */
export function reconcile(context) {
  const ticket = ticketNumber(context.ticket);
  const state = loadTicket(context.root, ticket);
  if (state === undefined) return;
  const github = githubStage(context, ticket, state);
  if (github === READY) return reconcileReady(context, ticket, state);
  if (github === undefined || github === state.stage) return state.stage;
  context.print(`reconcile #${ticket}: local=${state.stage} github=${github}; using github\n`);
  const logFile = runLogFile(context.root);
  saveTicket(context.root, ticket, { ...state, stage: github });
  logEvent(context, logFile, {
    ticket,
    event: 'reconcile',
    from: state.stage,
    to: github,
    detail: 'github',
  });
  return github;
}

// note, read (R-26)

/**
 * @param {string} text - Step summary.
 * @returns {string | undefined} The reason the summary is not valid, or undefined when it is valid.
 */
export function checkSummary(text) {
  const [first, ...rest] = text.split('\n');
  if (first.trimEnd() !== SUMMARY_HEADING)
    return `step summary must start with "${SUMMARY_HEADING}"`;
  const end = rest.findIndex((line) => line.startsWith('## '));
  const section = end === -1 ? rest : rest.slice(0, end);
  const bullets = section.filter((line) => line.startsWith('- ')).length;
  if (bullets < MIN_BULLETS || bullets > MAX_BULLETS) {
    return `step summary needs ${String(MIN_BULLETS)} to ${String(MAX_BULLETS)} bullets under "${SUMMARY_HEADING}", found ${String(bullets)}`;
  }
  return;
}

const stepFile = (root, ticket, step) =>
  path.join(stateFolder(root), ticket, 'steps', `${step}.md`);

function noteCommand([ticketWord, stepWord], context) {
  const ticket = ticketNumber(ticketWord);
  const step = plainName(stepWord, 'step name');
  const text = readInput(context);
  const problem = checkSummary(text);
  if (problem !== undefined) fail(problem);
  return withLock(context, () => {
    writeAtomic(stepFile(context.root, ticket, step), text.endsWith('\n') ? text : `${text}\n`);
    return `#${ticket}: stored step ${step}\n`;
  });
}

function readCommand([ticketWord, stepWord], context) {
  const ticket = ticketNumber(ticketWord);
  const step = plainName(stepWord, 'step name');
  if (step === PRE_PR) return listFindings(context, ticket);
  const text = readOptional(stepFile(context.root, ticket, step));
  return text ?? fail(`no summary for step ${step} of #${ticket}`);
}

export const SYNOPSES = [
  'stage <n> <stage>',
  'note <n> <step>   (summary on stdin)',
  'read <n> <step|pre-pr>',
  'round [<n>] start [--new]',
  'findings [<n>] add | set <id> <status> | list   (rows on stdin for add)',
];

export const COMMANDS = new Map([
  ['stage', stageCommand],
  ['note', noteCommand],
  ['read', readCommand],
  ['round', roundCommand],
  ['findings', findingsCommand],
]);

/**
 * @param {string} command - State command name.
 * @param {string[]} words - Arguments after the command.
 * @param {object} context - Command context.
 * @returns {string} Text to print.
 */
export function execute(command, words, context) {
  const handler = COMMANDS.get(command) ?? fail(`Usage: ${SYNOPSES.join('; ')}`);
  return handler(words, context);
}
