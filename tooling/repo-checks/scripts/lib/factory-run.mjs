// run.json of the /factory run (design factory-daily-run 4.3, R-50). `beginRun` starts a run or
// adopts the active or stalled one. The caller holds the lock. If the caller fails later, it calls
// `undo`: run.json is then as it was before `beginRun`. The caller calls `logAdoption` only after
// it succeeded.
import path from 'node:path';

import { fail, parseJson, stateFolder, timestamp } from './factory-base.mjs';
import { runLogFile, writeRunLog } from './factory-state.mjs';
import { readOptional, removeFile, writeAtomic } from './fs-io.mjs';

const runFile = (root) => path.join(stateFolder(root), 'run.json');
const NO_CHECKS = { count: 0, lastHash: null };

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
