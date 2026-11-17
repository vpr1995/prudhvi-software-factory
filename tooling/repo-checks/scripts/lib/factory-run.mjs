// run.json of the /factory run (design factory-daily-run 4.3, R-50). `beginRun` starts a run or
// adopts the active or stalled one. `clearRun` ends it (R-45). The caller holds the lock. If the caller fails later, it calls
// `undo`: run.json is then as it was before `beginRun`. The caller calls `logAdoption` only after
// it succeeded.
import path from 'node:path';

import { fail, isAlive, parseJson, stateFolder, timestamp } from './factory-base.mjs';
import { runLogFile, writeRunLog } from './factory-state.mjs';
import { readOptional, removeFile, writeAtomic } from './fs-io.mjs';

const runFile = (root) => path.join(stateFolder(root), 'run.json');
const NO_CHECKS = { count: 0, lastHash: null };
const WAIT_STALE_MS = 60 * 60_000;

/**
 * R-49. A wait is live when `wait` still runs: its pid is alive and it began less than 60 minutes
 * ago. A killed `wait` leaves `waiting` set, and a dead wait must not allow every stop. A wait with
 * no pid (or a bad one) is not live.
 *
 * @param {object} context - Command context (now). `context.isAlive` is for tests.
 * @param {object} run - The run.json object.
 * @returns {boolean} True when the run has a live CI wait.
 */
export function liveWait(context, run) {
  const waiting = run?.waiting;
  if (waiting === null || waiting === undefined) return false;
  if (!Number.isInteger(waiting.pid) || waiting.pid <= 0) return false;
  const since = Date.parse(waiting.since);
  if (Number.isNaN(since) || context.now().getTime() - since > WAIT_STALE_MS) return false;
  return (context.isAlive ?? isAlive)(waiting.pid);
}

/** @returns {object | undefined} The parsed run.json, or undefined when there is none. */
export function loadRun(root) {
  const text = readOptional(runFile(root));
  if (text === undefined) return;
  const run = parseJson(text, 'run.json');
  if (typeof run !== 'object' || run === null || Array.isArray(run)) {
    fail('run.json: must be a JSON object');
  }
  return run;
}

export const saveRun = (root, run) =>
  writeAtomic(runFile(root), `${JSON.stringify(run, undefined, 2)}\n`);

// A run id has no colon: it is a file name (`runs/<runId>.jsonl`), and runLogFile checks the name.
const newRunId = (now) => timestamp(now).replaceAll(/[-:]/g, '');

/**
 * R-50. An active or `stalled` run is adopted: the owning session is cleared (the next `stop-check`
 * claims it), `stalled` and the stop counts and the CI wait go (the old session is gone), `only` is
 * the new value. Else a new run starts. `resume` is not logged here: see `logAdoption`.
 *
 * @param {object} context - Command context (root, now).
 * @param {number | null} only - The ticket of `start <n>`, or null.
 * @returns {{ run: object, adopted: boolean, resumed: string | undefined, undo: () => void }} The
 *   stored run, the `resume` log text of an adopt, and the function that restores run.json.
 */
export function beginRun(context, only) {
  const file = runFile(context.root);
  const before = readOptional(file);
  const undo = () => (before === undefined ? removeFile(file) : writeAtomic(file, before));
  const existing = loadRun(context.root);
  if (existing?.active === true || existing?.stalled === true) {
    runLogFile(context.root); // refuses a run id that is not a plain name, before any write
    const run = {
      ...existing,
      active: true,
      stalled: false,
      sessionId: null,
      only,
      waiting: null,
      stopChecks: NO_CHECKS,
    };
    saveRun(context.root, run);
    const resumed = existing.stalled === true ? 'resumed (was stalled)' : 'resumed';
    return { run, adopted: true, resumed, undo };
  }
  const run = {
    runId: newRunId(context.now()),
    sessionId: null,
    sessionIds: [],
    active: true,
    stalled: false,
    startedAt: timestamp(context.now()),
    only,
    next: null,
    waiting: null,
    stopChecks: NO_CHECKS,
  };
  saveRun(context.root, run);
  return { run, adopted: false, resumed: undefined, undo };
}

/** Logs `resume` of an adopted run. Nothing for a new run. */
export function logAdoption(context, { resumed }) {
  if (resumed === undefined) return;
  writeRunLog(context, { ticket: 0, event: 'resume', from: null, to: null, detail: resumed });
}

const isUnset = (only) => only === null || only === undefined;
const isTicketNumber = (only) => Number.isInteger(only) && only > 0;

/**
 * The one reader of run.json `only`. `next` is strict: a bad value fails. `stop`, `report`, `status`
 * and hard-stop step 6 are not strict: a bad value is null (all tickets), so the kill switch (R-47)
 * and the report still work. They call `warnBadOnly` for the warning.
 *
 * @param {object | undefined} run - The parsed run.json.
 * @param {{ strict: boolean }} options - True: fail on a bad value. False: a bad value is null.
 * @returns {number | null} `only` of the run: a positive integer, or null.
 */
export function onlyOf(run, { strict }) {
  const only = run?.only;
  if (isUnset(only)) return null;
  if (isTicketNumber(only)) return only;
  return strict ? fail('run.json: only must be a positive integer or null') : null;
}

/** Prints one warning line to stderr when `only` is bad and the caller does not fail on it. */
export function warnBadOnly(context, run) {
  const only = run?.only;
  if (isUnset(only) || isTicketNumber(only)) return;
  context.err('warning: run.json only is not valid: treated as all tickets\n');
}

/** @returns {boolean} True when the run is active or stalled: `start` adopts it, `stop` ends it. */
export const isOpenRun = (run) => run?.active === true || run?.stalled === true;

/**
 * R-45. Ends the run: not active, not stalled, no CI wait, stop counts at 0. run.json stays: the
 * run report and the cost read (R-33) need `runId` and `sessionIds`. Safe to run again. The caller
 * holds the lock.
 *
 * @param {object} context - Command context (root).
 * @param {object | null} next - The `next` result to keep: `{ kind: 'done' }`, or null.
 * @returns {boolean} True when the run was open. False when there was no run, or it was ended.
 */
export function clearRun(context, next = null) {
  const run = loadRun(context.root);
  if (run === undefined) return false;
  saveRun(context.root, {
    ...run,
    active: false,
    stalled: false,
    next,
    waiting: null,
    stopChecks: NO_CHECKS,
  });
  return isOpenRun(run);
}
