// `next` and `status` of the /factory script (design factory-daily-run 4.1, 4.3; R-5, R-46).
//
// `next` finds the next step and stores it in run.json `next`:
//   { kind: 'wait', pr }                              a CI wait is stored in run.json `waiting`
//   { kind: 'comment', ticket, pr }                   a new owner comment to fix (R-30)
//   { kind: 'ticket', ticket, resume, stage?, stack? }  a ticket to resume (R-43), or to start
//   { kind: 'approve', ticket, paths, hash }          ask the owner first: protected paths (#146)
//   { kind: 'done' }                                  nothing can start (R-5)
//
// #146: `approve <n>` and `decline <n>` store the answer of the owner in run.json (`approvals`,
// `declined`). They change no label. After an approved ticket is green or done, `next` gives
// `done`: the other tickets wait for the next run.
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
import { fail, IN_FLIGHT, relative, ticketNumber, withLock } from './factory-base.mjs';
import { peekCaps } from './factory-caps.mjs';
import { findCommentStep } from './factory-comments.mjs';
import { buildPlan, DECLINED, localTickets, needsApproval, syncTickets } from './factory-queue.mjs';
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
  // The paths are fixed names of factory-queue-rules.mjs, not ticket text.
  if (next.kind === 'approve') {
    return `approve #${String(next.ticket)} (protected paths: ${next.paths.join(', ')})`;
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

function entryStep(entry) {
  if (entry.kind === 'resume') {
    return { kind: 'ticket', ticket: entry.number, resume: true, stage: entry.stage };
  }
  if (entry.approval !== undefined)
    return { kind: 'approve', ticket: entry.number, ...entry.approval };
  return {
    kind: 'ticket',
    ticket: entry.number,
    resume: false,
    ...(entry.stack === undefined ? {} : { stack: entry.stack }),
  };
}

const AFTER_PR = new Set(['green', 'done']);

// #146: an approved ticket of this run that is green or done ends the run.
const approvedTicketDone = (context, run) =>
  Object.keys(run.approvals ?? {}).some((ticket) =>
    AFTER_PR.has(loadTicket(context.root, ticketNumber(ticket))?.stage),
  );

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
  const resume = startable.find((candidate) => candidate.kind === 'resume');
  // A ticket that waits for a blocker CI is not skipped: the next `next` plans it again.
  const logged = skipped.filter((candidate) => candidate.wait === undefined);
  const asks = needsApproval(queue);
  if (resume === undefined && approvedTicketDone(context, run)) {
    return { step: { kind: 'done' }, skipped: logged, asks };
  }
  const entry = resume ?? startable[0];
  if (entry !== undefined) return { step: entryStep(entry), skipped: logged, asks };
  const waiting = skipped.find((candidate) => candidate.wait !== undefined);
  const step = waiting === undefined ? { kind: 'done' } : { kind: 'wait', pr: waiting.wait };
  return { step, skipped: logged, asks };
}

/** @returns {string} The text to print. */
export function nextCommand(words, context) {
  none('next', words);
  return withLock(context, () => {
    const stored = loadRun(context.root);
    if (stored?.active !== true) fail('no active run: run `start` first');
    // A killed `wait` leaves `waiting` set: a dead wait is no wait.
    const run = liveWait(context, stored) ? stored : { ...stored, waiting: null };
    const { step, skipped, asks } = chooseNext(context, run);
    logNewSkips(context, skipped);
    // A comment step returns before the plan: it has no list, so the stored list stays.
    const known = { ...run, needsApproval: asks ?? run.needsApproval };
    if (step.kind !== 'done') {
      saveRun(context.root, { ...known, next: step });
      return `next: ${describeNext(step)}\n`;
    }
    saveRun(context.root, known);
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
  return `${[runLine(run), now, capsLine(context, current), `next: ${describeNext(run.next)}`, approvalLine(run)].join('\n')}\n`;
}

// #146: the list that `start` or `next` stored last. The paths are fixed names, not ticket text.
function approvalLine(run) {
  const asks = Array.isArray(run.needsApproval) ? run.needsApproval : [];
  if (asks.length === 0) return 'needs approval: none';
  const shown = asks.map((ask) => `#${String(ask.ticket)} (${ask.paths.join(', ')})`);
  return `needs approval: ${shown.join(', ')}`;
}

// approve, decline (#146)

/** Runs the answer of the owner under the lock. The stored next step must be `approve #<n>`. */
function answer({ name, change }, words, context) {
  if (words.length !== 1) fail(`Usage: ${name} <n>`);
  const ticket = Number(ticketNumber(words[0]));
  return withLock(context, () => {
    const run = loadRun(context.root);
    if (run?.active !== true) fail('no active run: run `start` first');
    const { next } = run;
    if (next?.kind !== 'approve' || next.ticket !== ticket) {
      fail(`the next step is not approve #${String(ticket)}: run \`next\` first`);
    }
    // The ticket has an answer now: it leaves the list of `status`.
    const asks = Array.isArray(run.needsApproval) ? run.needsApproval : [];
    const answered = {
      ...run,
      next: null,
      needsApproval: asks.filter((ask) => ask?.ticket !== ticket),
    };
    return change(answered, ticket, next);
  });
}

/** @returns {string} The text to print. Stores the approval with the hash of the `Paths:` lines. */
export function approveCommand(words, context) {
  const change = (run, ticket, next) => {
    const approvals = { ...run.approvals, [String(ticket)]: { hash: next.hash } };
    saveRun(context.root, { ...run, approvals });
    return `#${String(ticket)}: approved for this run. Run \`next\`.\n`;
  };
  return answer({ name: 'approve', change }, words, context);
}

/** @returns {string} The text to print. Skips the ticket for this run and logs the skip. */
export function declineCommand(words, context) {
  const change = (run, ticket) => {
    const declined = [...(Array.isArray(run.declined) ? run.declined : []), ticket];
    saveRun(context.root, { ...run, declined });
    writeRunLog(context, { ticket, event: 'skip', from: null, to: null, detail: DECLINED });
    return `#${String(ticket)}: ${DECLINED}: skipped for this run. Run \`next\`.\n`;
  };
  return answer({ name: 'decline', change }, words, context);
}
