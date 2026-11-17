// `next` and `status` of the /factory script (design factory-daily-run 4.1, 4.3; R-5, R-46).
//
// `next` finds the next step and stores it in run.json `next`:
//   { kind: 'wait', pr }                              a CI wait is stored in run.json `waiting`
//   { kind: 'ticket', ticket, resume, stage?, stack? }  a ticket to resume (R-43), or to start
//   { kind: 'done' }                                  nothing can start (R-5)
// A resume ticket comes before a new one: the work of the run is not left half done. On `done`,
// `next` writes the run report (R-29) and clears the run (R-45). `next` calls no `gh` write, and it
// adds no run log line for a skip that the log already has: a repeated line would add active time
// to the ticket (R-15).
//
// Seam for task 6 (#101, R-30): a new owner comment on a factory PR comes before the queue. Put
// that finder in `chooseNext`, before `buildPlan`. Seam for task 7a (R-42): a blocker with a CI that
// runs gives a `wait` step. Today `buildPlan` skips that ticket.
//
// `status` only reads: it takes no lock and writes no file and makes no `gh` write.
import { fail, relative, withLock } from './factory-base.mjs';
import { peekCaps } from './factory-caps.mjs';
import { buildPlan, syncTickets } from './factory-queue.mjs';
import {
  currentTicket,
  IN_FLIGHT,
  readRunLog,
  STATUS_DONE,
  writeReport,
} from './factory-report.mjs';
import { clearRun, liveWait, loadRun, onlyOf, saveRun, warnBadOnly } from './factory-run.mjs';
import { writeRunLog } from './factory-state.mjs';

const none = (name, words) => {
  if (words.length > 0) fail(`Usage: ${name}`);
};

/**
 * @param {object | null | undefined} next - The stored step.
 * @param {{ withBranch?: boolean }} [options] - `withBranch: false` leaves out the stack branch
 *   name. It is GitHub text: the Stop hook must not show it.
 * @returns {string} The step as text.
 */
export function describeNext(next, { withBranch = true } = {}) {
  if (next === null || next === undefined) return 'none';
  if (next.kind === 'done') return 'done';
  if (next.kind === 'wait') return `wait for the CI of PR #${String(next.pr)}`;
  if (next.resume === true) return `resume #${String(next.ticket)} (stage ${next.stage})`;
  const { stack } = next;
  const branch = withBranch ? `, branch ${stack?.branch}` : '';
  const on =
    stack === undefined
      ? ''
      : `, stacked on #${String(stack.blocker)} (PR #${String(stack.pr)}${branch})`;
  return `start #${String(next.ticket)}${on}`;
}

const entryStep = (entry) =>
  entry.kind === 'resume'
    ? { kind: 'ticket', ticket: entry.number, resume: true, stage: entry.stage }
    : {
        kind: 'ticket',
        ticket: entry.number,
        resume: false,
        ...(entry.stack === undefined ? {} : { stack: entry.stack }),
      };

// A skip that the run log has already is not logged again.
function logNewSkips(context, skippedEntries) {
  const known = new Set(
    readRunLog(context.root)
      .filter((line) => line.event === 'skip')
      .map((line) => `${String(line.ticket)}|${line.detail}`),
  );
  for (const entry of skippedEntries) {
    if (!known.has(`${String(entry.number)}|${entry.skip}`)) {
      writeRunLog(context, {
        ticket: entry.number,
        event: 'skip',
        from: null,
        to: null,
        detail: entry.skip,
      });
    }
  }
}

function chooseNext(context, run) {
  // R-49: a live CI wait (by `wait`) is the next step. No gh call. `nextCommand` clears a dead one.
  if (run.waiting !== null && run.waiting !== undefined) {
    return { step: { kind: 'wait', pr: run.waiting.pr }, skipped: [] };
  }
  const only = onlyOf(run, { strict: true });
  syncTickets(context, only);
  const { queue, skipped } = buildPlan(context, only);
  // Only a ticket in flight resumes. A green, done or needs-human ticket does not resume and does
  // not block `done`.
  const startable = queue.filter(
    (candidate) => candidate.kind !== 'resume' || IN_FLIGHT.has(candidate.stage),
  );
  const entry = startable.find((candidate) => candidate.kind === 'resume') ?? startable[0];
  return { step: entry === undefined ? { kind: 'done' } : entryStep(entry), skipped };
}

/** @returns {string} The text to print. */
export function nextCommand(words, context) {
  none('next', words);
  return withLock(context, () => {
    const stored = loadRun(context.root);
    if (stored?.active !== true) fail('no active run: run `start` first');
    // A killed `wait` leaves `waiting` set: a dead wait is no wait.
    const run = liveWait(context, stored) ? stored : { ...stored, waiting: null };
    const { step, skipped } = chooseNext(context, run);
    logNewSkips(context, skipped);
    if (step.kind !== 'done') {
      saveRun(context.root, { ...run, next: step });
      return `next: ${describeNext(step)}\n`;
    }
    const file = writeReport(context, { status: STATUS_DONE });
    clearRun(context, step);
    return `next: done\nreport: ${relative(context.root, file)}\n`;
  });
}

// status (R-46)

function runLine(run) {
  const state = run.active === true ? 'active' : run.stalled === true ? 'stalled' : 'not active';
  const only = onlyOf(run, { strict: false });
  const scope = only === null ? 'all tickets' : `only #${String(only)}`;
  return `run: ${state} (${run.runId}, started ${run.startedAt}, ${scope})`;
}

function capsLine(context, current) {
  if (current === undefined) return 'caps: none (no current ticket)';
  const caps = peekCaps(context, String(current.ticket));
  const show = (value) => (value === null ? 'unknown' : String(value));
  const reached = caps.reached ? `; cap reached: ${caps.reason}` : '';
  return `caps: failed CI runs ${show(caps.failedCi)}, active minutes ${show(caps.activeMinutes)}${reached}`;
}

/** @returns {string} The run state. R-46. */
export function statusCommand(words, context) {
  none('status', words);
  const run = loadRun(context.root);
  if (run === undefined) return 'run: none (no run.json)\n';
  warnBadOnly(context, run);
  const current = currentTicket(context, run);
  const now =
    current === undefined
      ? 'current: none'
      : `current: #${String(current.ticket)}, stage ${current.stage}`;
  return `${[runLine(run), now, capsLine(context, current), `next: ${describeNext(run.next)}`].join('\n')}\n`;
}
