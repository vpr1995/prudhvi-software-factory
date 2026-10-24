import path from 'node:path';

import { keepFailureLogsNote } from './failure-logs.mjs';
import { writeText } from './fs-io.mjs';
import { isCi, MAX_REPORT_LINES } from './gates.config.mjs';
import {
  changedSince,
  contentHash,
  headSha,
  sessionBase,
  statePaths,
  treeHash,
  rushInstalled,
} from './git-state.mjs';
import { clipLines } from './hook-io.mjs';
import { impactOf } from './projects.mjs';
import { runRushVerify } from './rush-verify.mjs';
import {
  antiSkipCheck,
  cdkSynthCheck,
  fastChecks,
  opengrepCheck,
  secretsCheck,
} from './stop-checks.mjs';
import { coverageChecks } from './stop-coverage.mjs';

/** @typedef {import('./rush-verify.mjs').Check} Check */

const FOOTER =
  'Fix the cause. Do not skip, delete, or weaken tests or rules. Run the `verify` skill, then stop again.';
const STATE_VERSION = 1;

/**
 * Runs the project checks (Rush verify) for the changed projects.
 *
 * @param {string} root - Repo root.
 * @param {{ projects: string[], full: boolean }} impact - What changed.
 * @returns {Check[]} Checks.
 */
function projectChecks(root, impact) {
  if (!impact.full && impact.projects.length === 0) {
    return [{ name: 'rush verify', status: 'skip', detail: 'no Rush project changed' }];
  }
  if (!rushInstalled(root)) {
    return [
      {
        name: 'rush verify',
        status: 'fail',
        detail:
          'common/temp is missing, so Rush cannot run. Run `node common/scripts/install-run-rush.js install`, then stop again.',
      },
    ];
  }
  return runRushVerify(root, impact.full ? [] : impact.projects);
}

/**
 * Runs all checks for the changes of this session.
 *
 * @param {string} root - Repo root.
 * @param {'full' | 'fast'} mode - `fast` runs the quick checks only (for subagents).
 * @returns {{ checks: Check[], impact: { projects: string[], infraFolders: string[], full: boolean }, base: string }} Result.
 */
export function collectChecks(root, mode) {
  const base = sessionBase(root);
  const changed = changedSince(root, base);
  // Git already leaves out ignored build output, so every changed file is scanned.
  const { present } = changed;
  const impact = impactOf(root, changed.all);
  const antiSkip = antiSkipCheck(root, base);
  if (mode === 'fast') {
    return { checks: [antiSkip, ...fastChecks(root, present)], impact, base };
  }
  const checks = [
    antiSkip,
    secretsCheck(root, present),
    opengrepCheck(root, present),
    ...projectChecks(root, impact),
    ...coverageChecks(root, changed.all, impact.full),
    ...impact.infraFolders.map((folder) => cdkSynthCheck(root, folder)),
  ];
  return { checks, impact, base };
}

/**
 * Gets the failed checks. In CI, a check that skipped a required scanner counts as failed.
 *
 * @param {Check[]} checks - All checks.
 * @returns {Check[]} Checks with status `fail`.
 */
export function failedChecks(checks) {
  return checks.filter((check) => check.status === 'fail' || (check.degraded === true && isCi()));
}

/**
 * Formats the failure report for Claude.
 *
 * @param {Check[]} failed - Failed checks.
 * @param {string} [logsNote] - The line that tells where the logs are kept. It goes before the footer.
 * @returns {string} The report.
 */
export function formatFailureReport(failed, logsNote = '') {
  const parts = failed.map(
    (check, index) =>
      `${String(index + 1)}. ${check.name}\n${clipLines(check.detail, MAX_REPORT_LINES)}`,
  );
  const logs = logsNote === '' ? '' : `${logsNote}\n\n`;
  return `STOP BLOCKED: ${String(failed.length)} check${failed.length === 1 ? '' : 's'} failed.\n\n${parts.join('\n\n')}\n\n${logs}${FOOTER}`;
}

/**
 * Keeps the logs of the failed checks (lib/failure-logs.mjs), then formats the failure report with
 * the line that tells where the logs are.
 *
 * @param {string} root - Repo root.
 * @param {Check[]} failed - Failed checks.
 * @param {string} caller - Who stops: `stop` or `verify`. It is the first word of the step name.
 * @returns {string} The report.
 */
export function failureReportWithLogs(root, failed, caller) {
  const note = keepFailureLogsNote(root, {
    step: `${caller} ${failed[0]?.name ?? 'checks'}`,
    report: formatFailureReport(failed),
  });
  return formatFailureReport(failed, note);
}

/**
 * Writes the one-line summary of a run.
 *
 * @param {string} status - `pass`, `pass-with-skips` or `fail`.
 * @param {Check[]} failed - Failed checks.
 * @param {Check[]} degraded - Checks that skipped a required scanner.
 * @returns {string} The summary.
 */
function summaryOf(status, failed, degraded) {
  if (status === 'fail') {
    return `${String(failed.length)} check(s) failed: ${failed.map((check) => check.name).join(', ')}`;
  }
  return status === 'pass-with-skips'
    ? `all checks passed, but a required scanner did not run: ${degraded.map((check) => check.name).join(', ')}`
    : 'all checks passed';
}

/**
 * Writes `.claude/state/last-verify.json` for the current tree.
 *
 * @param {string} root - Repo root.
 * @param {{ checks: Check[], impact: { projects: string[], infraFolders: string[] }, base: string }} run - A full run.
 * @param {string} mode - Who wrote it: `stop-gate` or `write-state-only`.
 * @returns {{ status: 'pass' | 'pass-with-skips' | 'fail' }} The saved status.
 */
export function writeVerifyState(root, run, mode) {
  const failed = failedChecks(run.checks);
  const degraded = run.checks.filter((check) => check.degraded === true);
  let status = 'pass';
  if (failed.length > 0) {
    status = 'fail';
  } else if (degraded.length > 0) {
    status = 'pass-with-skips';
  }
  const state = {
    version: STATE_VERSION,
    status,
    result: status,
    mode,
    treeHash: treeHash(root),
    contentHash: contentHash(root),
    headSha: headSha(root),
    sessionBase: run.base,
    createdAt: new Date().toISOString(),
    impactedProjects: run.impact.projects,
    infraFolders: run.impact.infraFolders,
    checks: run.checks.map((check) => ({
      name: check.name,
      status: check.status,
      detail: clipLines(check.detail, 10),
    })),
    summary: summaryOf(status, failed, degraded),
  };
  writeText(statePaths(root).lastVerify, `${JSON.stringify(state, null, 2)}\n`);
  return { status };
}

/**
 * Gets a short description of the state file for messages.
 *
 * @param {string} root - Repo root.
 * @returns {string} Path of the state file from the repo root.
 */
export function stateFileName(root) {
  return path.relative(root, statePaths(root).lastVerify);
}
