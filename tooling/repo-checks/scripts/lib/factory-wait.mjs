// `wait <n>` of the /factory script (design factory-daily-run 4.1; R-49). The agent runs it as a
// background command while CI runs. It stores `waiting: { pr, since, pid }` in run.json, so the
// Stop hook allows the stop. It refuses a PR that is not the `pr` of a ticket.json. The hook and
// `next` ignore a wait of a dead pid, or older than 60 minutes (`liveWait`).
// It polls `gh pr checks` every 30 seconds. It ends when no check is pending and clears `waiting`.
// It prints `passed` or `failed`. After 60 minutes it prints `timeout` and ends with a hard stop
// (exit 3, message `hard stop: CI timeout`): the agent then runs `hardstop`. The same rule applies
// to the blocker wait of R-42.
//
// A test sets `context.sleep` (milliseconds), `context.pollMs`, `context.timeoutMs` and `context.now`.
// The wait writes a `wait` run log line with detail `start` and one with `end`. `caps` leaves the
// time between them out of the active time (R-15).
import {
  fail,
  sleepFor,
  stateFolder,
  timestamp,
  withLock,
  withPatientLock,
} from './factory-base.mjs';
import { HardStopError } from './factory-github.mjs';
import { loadRun, saveRun } from './factory-run.mjs';
import { checksGreen, ghJson, loadTicket, writeRunLog } from './factory-state.mjs';
import { listFolder } from './fs-io.mjs';

export const POLL_MS = 30_000;
export const TIMEOUT_MS = 60 * 60_000;
const TICKET_FOLDER = /^[1-9]\d*$/;

// The ticket of the PR: the ticket.json that names it. A PR that no ticket names is refused.
function ticketOfPr(context, pr) {
  const folders = listFolder(stateFolder(context.root)).filter((name) => TICKET_FOLDER.test(name));
  const match = folders.find((name) => loadTicket(context.root, name)?.pr === pr);
  if (match === undefined) fail(`PR #${String(pr)} is not a PR of this run`);
  return Number(match);
}

const logWait = (context, ticket, detail) =>
  writeRunLog(context, { ticket, event: 'wait', from: null, to: null, detail });

function begin(context, pr) {
  return withLock(context, () => {
    const run = loadRun(context.root);
    if (run?.active !== true) fail('no active run: run `start` first');
    const ticket = ticketOfPr(context, pr);
    const waiting = { pr, since: timestamp(context.now()), pid: context.pid };
    saveRun(context.root, { ...run, waiting });
    logWait(context, ticket, 'start');
    return ticket;
  });
}

function finish(context, pr, ticket) {
  withPatientLock(context, () => {
    const run = loadRun(context.root);
    // `stop` or a hard stop can clear the wait first. Then there is nothing to do.
    if (run?.waiting?.pr !== pr) return;
    saveRun(context.root, { ...run, waiting: null });
    logWait(context, ticket, 'end');
  });
}

/** @returns {boolean} True when CI ended: there are checks and none is pending. */
const ended = (checks) =>
  Array.isArray(checks) && checks.length > 0 && !checks.some((check) => check.bucket === 'pending');

function poll(context, pr, timing) {
  const started = context.now().getTime();
  for (;;) {
    const checks = ghJson(context, ['pr', 'checks', String(pr), '--json', 'name,state,bucket']);
    if (!Array.isArray(checks)) fail('gh pr checks: not a list');
    if (ended(checks)) return checksGreen(checks) ? 'passed' : 'failed';
    if (context.now().getTime() - started >= timing.timeoutMs) return 'timeout';
    timing.sleep(timing.pollMs);
  }
}

/** @returns {string} The text to print. Throws HardStopError on a timeout. */
export function waitCommand(words, context) {
  const [word, ...extra] = words;
  if (word === undefined || !/^[1-9]\d*$/.test(word) || extra.length > 0) fail('Usage: wait <n>');
  const pr = Number(word);
  const timing = {
    pollMs: context.pollMs ?? POLL_MS,
    timeoutMs: context.timeoutMs ?? TIMEOUT_MS,
    sleep: context.sleep ?? sleepFor,
  };
  const ticket = begin(context, pr);
  let result;
  try {
    result = poll(context, pr, timing);
  } finally {
    finish(context, pr, ticket);
  }
  if (result === 'timeout') {
    context.print(
      `timeout: the CI of PR #${word} did not end in ${String(timing.timeoutMs / 60_000)} minutes\n`,
    );
    throw new HardStopError('CI timeout');
  }
  return `CI of PR #${word} ended: ${result}\n`;
}
