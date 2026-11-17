// Run report, `stop` and `report` of the /factory script (design factory-daily-run 4.1, 4.3; R-29,
// R-45, R-47). The report is the file `runs/<runId>-report.md`. It is built from local data only:
// run.json, the run log of the run, and the `ticket.json` files. It makes no `gh` call, and it holds
// no issue title and no issue body: a ticket shows as a number and a fixed reason.
//
// `status` is a plain text of the end of the run. The command that ends the run gives it. A later
// `report` derives it from run.json. A hard stop (`recordStop`) stores `stopped` in run.json:
// `{ ticket, reason, failedSteps }`. `failedSteps` are the R-12 steps that failed before step 6, as
// `<number> <name>` ("4 comment"). A second hard stop of the same run writes the same report.
import { fail, relative, withLock } from './factory-base.mjs';
import { redactText } from './factory-comment.mjs';
import { clearRun, isOpenRun, loadRun, saveRun } from './factory-run.mjs';
import { loadTicket, runLogFile, writeRunLog } from './factory-state.mjs';
import { readOptional, writeAtomic } from './fs-io.mjs';

const STATUS_DONE = 'run ended: no ticket can start (R-5)';
const STATUS_STOP = 'stopped by the owner (R-47)';
const STATUS_HARD_STOP = 'hard stop (R-12)';
const STATUS_ACTIVE = 'active';
const STATUS_STALLED = 'stalled: run `/factory` to resume (R-48)';
const IN_FLIGHT = new Set(['building', 'reviewing', 'ci']);
const LOG_SUFFIX = '.jsonl';
const NO_WORDS = (name, words) => {
  if (words.length > 0) fail(`Usage: ${name}`);
};

/** @returns {object[]} The lines of the run log of the current run. [] when there is no log. */
export function readRunLog(root) {
  return (readOptional(runLogFile(root)) ?? '')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return fail('run log: a line is not valid JSON');
      }
    });
}

const reportFile = (root) => `${runLogFile(root).slice(0, -LOG_SUFFIX.length)}-report.md`;
const isWork = (line) => line.ticket > 0 && line.event !== 'skip';

/** @returns {{ ticket: number, stage: string } | undefined} The last worked ticket that is still in flight. */
export function currentTicket(context) {
  const worked = readRunLog(context.root).filter((line) => isWork(line));
  const numbers = [...new Set(worked.map((line) => line.ticket).toReversed())];
  for (const ticket of numbers) {
    const stage = loadTicket(context.root, String(ticket))?.stage;
    if (IN_FLIGHT.has(stage)) return { ticket, stage };
  }
  return;
}

/** @returns {string} The command that resumes the run. R-50: `/factory` adopts the run. */
const resumeCommand = (run) =>
  `\`/factory${typeof run?.only === 'number' ? ` ${String(run.only)}` : ''}\``;

function statusOf(run, stopped) {
  if (run?.next?.kind === 'done') return STATUS_DONE;
  if (stopped !== undefined) return STATUS_HARD_STOP;
  if (run === undefined || run.active === true) return STATUS_ACTIVE;
  return run.stalled === true ? STATUS_STALLED : STATUS_STOP;
}

const list = (items) => (items.length === 0 ? 'none' : items.map((item) => `- ${item}`).join('\n'));
const byNumber = (first, second) => first - second;

// The tickets of the run that have a log line other than a skip, with their stored state.
function workedTickets(context, lines) {
  const numbers = [...new Set(lines.filter((line) => isWork(line)).map((line) => line.ticket))];
  return numbers
    .toSorted(byNumber)
    .map((ticket) => ({ ticket, state: loadTicket(context.root, String(ticket)) }))
    .filter(({ state }) => state !== undefined);
}

// One reason for each skipped ticket: the last. A hard stop step with no stage is not a skip.
function skipped(lines) {
  const reasons = new Map();
  for (const line of lines) {
    if (line.event === 'skip' && line.ticket > 0 && !String(line.detail).startsWith('step ')) {
      reasons.set(line.ticket, line.detail);
    }
  }
  const started = new Set(lines.filter((line) => isWork(line)).map((line) => line.ticket));
  return [...reasons]
    .filter(([ticket]) => !started.has(ticket))
    .toSorted(([first], [second]) => first - second)
    .map(([ticket, reason]) => `#${String(ticket)}: ${reason}`);
}

function sections(context, run, stopped) {
  const lines = readRunLog(context.root);
  const worked = workedTickets(context, lines);
  const done = worked.filter(({ state }) => state.stage === 'green' || state.stage === 'done');
  const pr = ({ state }) => (Number.isInteger(state.pr) ? state.pr : undefined);
  const current = currentTicket(context);
  const resume = [resumeCommand(run)];
  if (stopped !== undefined) {
    resume.push(
      `After you fix #${String(stopped.ticket)}: remove \`needs-human\`, add \`agent:ready\`.`,
    );
  }
  return [
    [
      'Current ticket',
      current === undefined ? 'none' : `#${String(current.ticket)}, stage ${current.stage}`,
    ],
    [
      'Tickets done',
      list(
        done.map((entry) =>
          pr(entry) === undefined
            ? `#${String(entry.ticket)}`
            : `#${String(entry.ticket)}, PR #${String(pr(entry))}`,
        ),
      ),
    ],
    [
      'PRs that wait for a merge',
      list(
        done
          .filter((entry) => entry.state.stage === 'green' && pr(entry) !== undefined)
          .map((entry) => `PR #${String(pr(entry))} (#${String(entry.ticket)})`),
      ),
    ],
    [
      'Ticket that stopped',
      list(
        stopped === undefined ? [] : [`#${String(stopped.ticket)}: ${redactText(stopped.reason)}`],
      ),
    ],
    ['Tickets skipped', list(skipped(lines))],
    [
      'Hard-stop steps that failed',
      list((stopped?.failedSteps ?? []).map((step) => `step ${step}`)),
    ],
    ['Resume command', resume.join('\n\n')],
  ];
}

/**
 * R-29. Writes the run report. Safe to run again: the text has no time of writing. The caller holds
 * the lock.
 *
 * @param {object} context - Command context (root).
 * @param {{ status?: string, stopped?: object }} [options] - The status text, and the hard stop of
 *   the run. Each one that is missing comes from run.json.
 * @returns {string} The path of the report file.
 */
export function writeReport(context, { status, stopped } = {}) {
  const run = loadRun(context.root);
  const hardStop = stopped ?? run?.stopped;
  const head = [
    `# Run report: ${run?.runId ?? 'adhoc'}`,
    '',
    `Status: ${status ?? statusOf(run, hardStop)}`,
    `Started: ${run?.startedAt ?? 'unknown'}`,
    `Scope: ${typeof run?.only === 'number' ? `only #${String(run.only)}` : 'all tickets'}`,
  ];
  const body = sections(context, run, hardStop).flatMap(([name, text]) => [
    `## ${name}`,
    '',
    text,
    '',
  ]);
  const file = reportFile(context.root);
  writeAtomic(file, `${[...head, '', ...body].join('\n')}`);
  return file;
}

/**
 * R-12 step 6. Stores the hard stop in run.json (when a run exists), then writes the report.
 *
 * @param {object} context - Command context (root).
 * @param {{ ticket: string, reason: string, failedSteps: string[] }} stop - The hard stop.
 * @returns {string} The line for the step.
 */
export function recordStop(context, stop) {
  const stopped = {
    ticket: Number(stop.ticket),
    reason: redactText(stop.reason),
    failedSteps: stop.failedSteps,
  };
  const run = loadRun(context.root);
  if (run !== undefined) saveRun(context.root, { ...run, stopped });
  return `wrote ${relative(context.root, writeReport(context, { stopped }))}`;
}

/**
 * R-12 step 7, R-45. Ends the run. Safe to run again.
 *
 * @param {object} context - Command context (root).
 * @returns {string} The line for the step.
 */
export function clearForStop(context) {
  if (loadRun(context.root) === undefined) return 'no active run';
  return clearRun(context) ? 'run cleared' : 'already cleared';
}

/** R-47. @returns {string} The text to print. */
export function stopCommand(words, context) {
  NO_WORDS('stop', words);
  return withLock(context, () => {
    const run = loadRun(context.root);
    if (!isOpenRun(run)) return 'no active run: nothing to stop\n';
    writeRunLog(context, { ticket: 0, event: 'stop', from: null, to: null, detail: STATUS_STOP });
    const file = writeReport(context, { status: STATUS_STOP });
    clearRun(context);
    return `run ${run.runId}: stopped. Labels and ticket state are as they were.\nreport: ${relative(context.root, file)}\nresume: ${resumeCommand(run)}\n`;
  });
}

/** R-29. @returns {string} The path and the text of the report. */
export function reportCommand(words, context) {
  NO_WORDS('report', words);
  return withLock(context, () => {
    if (loadRun(context.root) === undefined)
      fail('no run: there is no run.json. Run `start` first');
    const file = writeReport(context);
    return `report: ${relative(context.root, file)}\n\n${readOptional(file)}`;
  });
}

export { STATUS_DONE };
