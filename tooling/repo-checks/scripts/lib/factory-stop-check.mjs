// The factory Stop hook (design factory-daily-run 4.7; R-44, R-45, R-48). The entry is
// scripts/factory-stop-check.mjs. It reads only local state: run.json, the run log and ticket.json.
// It makes no `gh` call. It returns the hook output (JSON) that blocks, or undefined to allow.
//
// Rules, in this order:
//   - FACTORY_RUN=off: allow, and clear the open run (R-45).
//   - No open run, or the run is `stalled`: allow.
//   - The run has an owner and it is another session: allow.
//   - The first check after `start` claims the run: it stores the session id (R-44).
//   - `next` is `done`, or the run waits for CI (`waiting`): allow (R-44, R-49).
//   - Else block with the stored next step. A hash of (stage, counts, `next`, last run log line)
//     that stays the same for 3 blocks marks the run `stalled` (R-48).
import { createHash } from 'node:crypto';

import { fail, parseJson, withLock } from './factory-base.mjs';
import { describeNext } from './factory-next.mjs';
import { currentTicket, readRunLog, writeReport } from './factory-report.mjs';
import { clearRun, isOpenRun, loadRun, saveRun } from './factory-run.mjs';
import { writeRunLog } from './factory-state.mjs';

const MAX_SAME_BLOCKS = 3;
const NO_CHECKS = { count: 0, lastHash: null };
const NEXT_COMMAND = 'node tooling/repo-checks/scripts/factory.mjs next';

function sessionOf(text) {
  const input = parseJson(text, 'hook input');
  const session = input?.session_id;
  if (typeof session !== 'string' || session === '') fail('hook input has no session_id');
  return session;
}

const block = (reason) => JSON.stringify({ decision: 'block', reason });

function reasonOf(next) {
  const step = next === null || next === undefined ? `run \`${NEXT_COMMAND}\`` : describeNext(next);
  return `Factory run is active. Next step: ${step}. Do it. Run \`${NEXT_COMMAND}\` before you stop.`;
}

// The state that must change when the run makes progress. The counts are the lines of the run log.
function stateHash(context, run) {
  const lines = readRunLog(context.root);
  const parts = [
    currentTicket(context, run)?.stage ?? null,
    lines.length,
    run.next ?? null,
    lines.at(-1) ?? null,
  ];
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

// R-48. The run is `stalled`, not active: `next` refuses it and `start` adopts it. No label change.
function stall(context, run) {
  saveRun(context.root, { ...run, active: false, stalled: true, stopChecks: NO_CHECKS });
  writeRunLog(context, {
    ticket: 0,
    event: 'stall',
    from: null,
    to: null,
    detail: `no progress in ${String(MAX_SAME_BLOCKS)} blocked stops`,
  });
  writeReport(context);
}

function ownerCheck(context, session) {
  const run = loadRun(context.root);
  if (!isOpenRun(run) || run.stalled === true) return;
  const owner = run.sessionId ?? null;
  if (owner !== null && owner !== '' && owner !== session) return;
  const ids = Array.isArray(run.sessionIds) ? run.sessionIds : [];
  const claimed = {
    ...run,
    sessionId: session,
    sessionIds: ids.includes(session) ? ids : [...ids, session],
  };
  if (run.next?.kind === 'done') return;
  if (run.waiting !== null && run.waiting !== undefined) {
    if (claimed.sessionId !== owner) saveRun(context.root, claimed);
    return;
  }
  const prior = run.stopChecks ?? NO_CHECKS;
  const hash = stateHash(context, run);
  const same = prior.lastHash === hash;
  if (same && prior.count >= MAX_SAME_BLOCKS) {
    stall(context, claimed);
    return;
  }
  saveRun(context.root, {
    ...claimed,
    stopChecks: { count: same ? prior.count + 1 : 1, lastHash: hash },
  });
  return block(reasonOf(run.next));
}

/**
 * @param {string} text - The hook input (JSON text, with `session_id`).
 * @param {object} context - root, now, pid, runOff, err.
 * @returns {string | undefined} The hook output that blocks, or undefined to allow. An error throws.
 */
export function handleStopCheck(text, context) {
  const session = sessionOf(text);
  const run = loadRun(context.root);
  if (run === undefined) return;
  if (context.runOff()) {
    if (isOpenRun(run)) withLock(context, () => clearRun(context));
    return;
  }
  if (!isOpenRun(run) || run.stalled === true) return;
  const owner = run.sessionId ?? null;
  if (owner !== null && owner !== '' && owner !== session) return;
  return withLock(context, () => ownerCheck(context, session));
}
