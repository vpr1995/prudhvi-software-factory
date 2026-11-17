// `next` and `status` of the /factory script (design factory-daily-run 4.1, 4.3; R-5, R-46).
//
// `next` finds the next step and stores it in run.json `next`:
//   { kind: 'wait', pr }                              a CI wait is stored in run.json `waiting`
//   { kind: 'comment', ticket, pr }                   a new owner comment to fix (R-30)
//   { kind: 'ticket', ticket, resume, stage?, stack? }  a ticket to resume (R-43), or to start
//   { kind: 'done' }                                  nothing can start (R-5)
// Order: a ticket in flight resumes first, then owner comments, then a new ticket: the work of the run
// is not left half done, and only one ticket is in flight. On `done`,
// `next` writes the run report (R-29) and clears the run (R-45). `next` calls no `gh` write, and it
// adds no run log line for a skip that the log already has: a repeated line would add active time
// to the ticket (R-15).
//
// R-30: a new owner comment on the open PR of a green ticket comes before a new ticket, and after the
// resume of a ticket in flight (lib/factory-comments.mjs).
// R-42: a ticket with a blocker PR whose CI runs gives a `wait` step for that PR, when no other
// ticket can start (board order of the others is kept). `start` still lists that ticket as skipped.
// R-41: a hard stop when the blocker PR of a stacked ticket in flight closed with no merge.
//
// `status` only reads: it takes no lock and writes no file and makes no `gh` write.
import { fail, IN_FLIGHT, relative, withLock } from './factory-base.mjs';
import { peekCaps } from './factory-caps.mjs';
import { findCommentStep } from './factory-comments.mjs';
import { buildPlan, localTickets, syncTickets } from './factory-queue.mjs';
import { currentTicket, readRunLog, STATUS_DONE, writeReport } from './factory-report.mjs';
import { clearRun, liveWait, loadRun, onlyOf, saveRun, warnBadOnly } from './factory-run.mjs';
import { checkStackParent } from './factory-stack.mjs';
import { loadTicket, writeRunLog } from './factory-state.mjs';

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
  if (next.kind === 'comment') {
    return `fix owner comments of #${String(next.ticket)} (PR #${String(next.pr)})`;
  }
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

// R-41: each ticket that is still stacked has a blocker PR that did not close with no merge.
function checkStackParents(context, only) {
  for (const ticket of localTickets(context.root, only)) {
    checkStackParent(context, ticket, loadTicket(context.root, ticket));
  }
}

function chooseNext(context, run) {
  // R-49: a live CI wait (by `wait`) is the next step. No gh call. `nextCommand` clears a dead one.
  if (run.waiting !== null && run.waiting !== undefined) {
    return { step: { kind: 'wait', pr: run.waiting.pr }, skipped: [] };
  }
  const only = onlyOf(run, { strict: true });
  syncTickets(context, only);
  checkStackParents(context, only);
  // R-30: a new owner comment on the PR of a green ticket comes before a new ticket, but not while a
  // ticket is in flight (it gives nothing then). A hard stop (R-31) is thrown here.
  const comment = findCommentStep(context, only);
  if (comment !== undefined) return { step: comment, skipped: [] };
  const { queue, skipped } = buildPlan(context, only);
  // Only a ticket in flight resumes. A green, done or needs-human ticket does not resume and does
  // not block `done`.
  const startable = queue.filter(
    (candidate) => candidate.kind !== 'resume' || IN_FLIGHT.has(candidate.stage),
  );
  const entry = startable.find((candidate) => candidate.kind === 'resume') ?? startable[0];
  // A ticket that waits for a blocker CI is not skipped: the next `next` plans it again.
  const logged = skipped.filter((candidate) => candidate.wait === undefined);
  if (entry !== undefined) return { step: entryStep(entry), skipped: logged };
  const waiting = skipped.find((candidate) => candidate.wait !== undefined);
  const step = waiting === undefined ? { kind: 'done' } : { kind: 'wait', pr: waiting.wait };
  return { step, skipped: logged };
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
