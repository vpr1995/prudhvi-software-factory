// Stop and SubagentStop hook. It blocks "done" until the checks for this session pass.
//   stop-gate.mjs                    Stop hook (all checks, loop guard, writes the verify state)
//   stop-gate.mjs --fast             SubagentStop hook (quick checks, no state)
//   stop-gate.mjs --write-state-only run all checks, write the verify state, exit 0 pass or 1 fail
// A failed full run (Stop hook or --write-state-only) keeps the rush-logs and test-results folders in
// .claude/state/failure-logs/ (lib/failure-logs.mjs), and the report names that folder.
import {
  committedSinceSession,
  committedWarning,
  uncommitted,
  uncommittedMessage,
} from '../lib/gate-integrity.mjs';
import { STOP_ATTEMPT_LIMIT } from '../lib/gates.config.mjs';
import {
  limitReached,
  readCounter,
  readVerifyState,
  statePaths,
  verifyIsCurrent,
  writeCounter,
} from '../lib/git-state.mjs';
import { blockWith, runHook } from '../lib/hook-io.mjs';
import {
  collectChecks,
  failedChecks,
  failureReportWithLogs,
  formatFailureReport,
  stateFileName,
  writeVerifyState,
} from '../lib/stop-run.mjs';

const args = new Set(process.argv.slice(2));
const FAST = args.has('--fast');
const WRITE_STATE_ONLY = args.has('--write-state-only');
const LAST_RETRY =
  'LAST RETRY: the next stop will pass. Your final message must list the checks that still fail. Do not say the work is done.';

/**
 * Makes the result for a stop that passes but carries a warning for the user.
 *
 * @param {string} message - Warning text.
 * @returns {import('../lib/hook-io.mjs').HookResult} Result with a systemMessage.
 */
function passWithWarning(message) {
  return { stdout: JSON.stringify({ systemMessage: message }) };
}

/**
 * Lets a stop pass. Commits that changed gate files add a warning line.
 *
 * @param {string} warning - The commit warning (empty for none).
 * @returns {import('../lib/hook-io.mjs').HookResult} Result.
 */
function passResult(warning) {
  return warning === '' ? { exitCode: 0 } : passWithWarning(warning);
}

/**
 * Adds the commit warning to a text.
 *
 * @param {string} text - Text for Claude.
 * @param {string} warning - The commit warning (empty for none).
 * @returns {string} The text with the warning on a new line.
 */
function withWarning(text, warning) {
  return warning === '' ? text : `${text}\n\n${warning}`;
}

/**
 * Handles the quick SubagentStop run.
 *
 * @param {import('../lib/hook-io.mjs').HookContext} context - Hook context.
 * @returns {import('../lib/hook-io.mjs').HookResult} Result.
 */
function fastGate(context) {
  const warning = committedWarning(committedSinceSession(context.root));
  const gateChanges = uncommitted(context.root);
  const failed = failedChecks(collectChecks(context.root, 'fast').checks);
  if (gateChanges.length === 0 && failed.length === 0) {
    return passResult(warning);
  }
  const parts = [
    ...(gateChanges.length > 0 ? [`STOP BLOCKED: ${uncommittedMessage(gateChanges)}`] : []),
    ...(failed.length > 0 ? [formatFailureReport(failed)] : []),
  ];
  const report = withWarning(parts.join('\n\n'), warning);
  return context.payload['stop_hook_active'] === true
    ? passWithWarning(`Subagent stopped with failing checks:\n${report}`)
    : blockWith(report);
}

/**
 * Runs all checks and writes the verify state, for the verify skill.
 *
 * @param {import('../lib/hook-io.mjs').HookContext} context - Hook context.
 * @returns {import('../lib/hook-io.mjs').HookResult} Result.
 */
function writeStateOnly(context) {
  const run = collectChecks(context.root, 'full');
  const { status } = writeVerifyState(context.root, run, 'write-state-only');
  if (status !== 'fail') {
    return {
      stdout: `verify: ${status}. State saved in ${stateFileName(context.root)}.${status === 'pass' ? '' : ' A required scanner did not run: install it and verify again before a push.'}`,
    };
  }
  return {
    exitCode: 1,
    stderr: `${failureReportWithLogs(context.root, failedChecks(run.checks), 'verify')}\nState saved in ${stateFileName(context.root)} with status fail.`,
  };
}

/**
 * Handles the Stop hook with the loop guard. A crash anywhere (a git call, a file-system call)
 * blocks the stop with a short message and counts as a blocked stop, so the loop guard still ends
 * a crash loop.
 *
 * @param {import('../lib/hook-io.mjs').HookContext} context - Hook context.
 * @returns {import('../lib/hook-io.mjs').HookResult} Result.
 */
function stopGate(context) {
  const counterFile = statePaths(context.root).stopAttempts;
  try {
    return guardedStop(context, counterFile);
  } catch (error) {
    return crashBlock(counterFile, error);
  }
}

/**
 * Makes the blocking result for a crash that is not tied to one check. It bumps the loop counter
 * when it can, and passes with a warning when the limit is reached.
 *
 * @param {string} counterFile - The stop-attempts file.
 * @param {unknown} error - The thrown value.
 * @returns {import('../lib/hook-io.mjs').HookResult} Result.
 */
function crashBlock(counterFile, error) {
  let attempt = 1;
  try {
    attempt = readCounter(counterFile) + 1;
    if (limitReached(attempt)) {
      writeCounter(counterFile, 0);
      return passWithWarning(
        `stop-gate: ${String(STOP_ATTEMPT_LIMIT)} stops were blocked, so this stop passes. The gate itself crashed: ${errorText(error)}. A human must check the work.`,
      );
    }
    writeCounter(counterFile, attempt);
  } catch {
    // The counter file cannot be used. The stop stays blocked and the message names the first cause.
  }
  return blockWith(crashReport(error, attempt));
}

/**
 * The stop logic without the crash handler.
 *
 * @param {import('../lib/hook-io.mjs').HookContext} context - Hook context.
 * @param {string} counterFile - The stop-attempts file.
 * @returns {import('../lib/hook-io.mjs').HookResult} Result.
 */
function guardedStop(context, counterFile) {
  const { root } = context;
  if (context.payload['stop_hook_active'] !== true) {
    writeCounter(counterFile, 0);
  }
  // Gate files come first. A saved verify state must not be able to hide a gate change.
  const warning = committedWarning(committedSinceSession(root));
  const gateChanges = uncommitted(root);
  if (gateChanges.length > 0) {
    return gateBlock(counterFile, gateChanges, warning);
  }
  const state = readVerifyState(root);
  if (verifyIsCurrentOrThrow(root, state)) {
    writeCounter(counterFile, 0);
    return passResult(warning);
  }
  const attempt = readCounter(counterFile) + 1;
  if (limitReached(attempt)) {
    writeCounter(counterFile, 0);
    const summary = typeof state?.['summary'] === 'string' ? state['summary'] : 'unknown';
    return passWithWarning(
      withWarning(
        `stop-gate: ${String(STOP_ATTEMPT_LIMIT)} stops were blocked, so this stop passes. Last result: ${summary}. A human must check the work.`,
        warning,
      ),
    );
  }
  let run;
  let status;
  try {
    run = collectChecks(root, 'full');
    ({ status } = writeVerifyState(root, run, 'stop-gate'));
  } catch (error) {
    // A crash must not give a silent pass. It counts as a blocked stop, so the loop guard still ends it.
    writeCounter(counterFile, attempt);
    return blockWith(withWarning(crashReport(error, attempt), warning));
  }
  if (status !== 'fail') {
    writeCounter(counterFile, 0);
    return passResult(warning);
  }
  writeCounter(counterFile, attempt);
  const report = failureReportWithLogs(root, failedChecks(run.checks), 'stop');
  return blockWith(
    withWarning(attempt >= STOP_ATTEMPT_LIMIT ? `${report}\n\n${LAST_RETRY}` : report, warning),
  );
}

/**
 * Handles a Stop with changed gate files: it blocks, and the loop guard ends the loop after three
 * blocks (only a human can fix the cause). The warning names the files.
 *
 * @param {string} counterFile - The loop guard counter file.
 * @param {import('../lib/gate-integrity.mjs').GateChange[]} gateChanges - Changed gate files.
 * @param {string} warning - The commit warning (empty for none).
 * @returns {import('../lib/hook-io.mjs').HookResult} Result.
 */
function gateBlock(counterFile, gateChanges, warning) {
  const attempt = readCounter(counterFile) + 1;
  const report = `STOP BLOCKED: ${uncommittedMessage(gateChanges)}`;
  if (limitReached(attempt)) {
    writeCounter(counterFile, 0);
    return passWithWarning(
      withWarning(
        `stop-gate: ${String(STOP_ATTEMPT_LIMIT)} stops were blocked, so this stop passes. Gate files are still changed. A human must check the work.\n${report}`,
        warning,
      ),
    );
  }
  writeCounter(counterFile, attempt);
  return blockWith(
    withWarning(attempt >= STOP_ATTEMPT_LIMIT ? `${report}\n\n${LAST_RETRY}` : report, warning),
  );
}

/**
 * Tells whether the saved verify state passes for the current tree. It throws when git fails.
 *
 * @param {string} root - Repo root.
 * @param {Record<string, unknown> | null} state - The saved verify state.
 * @returns {boolean} True when the stop may pass at once.
 */
function verifyIsCurrentOrThrow(root, state) {
  const passed = state?.['status'] === 'pass' || state?.['status'] === 'pass-with-skips';
  return passed && verifyIsCurrent(root, { allowSkips: true }).ok;
}

/**
 * Gets a one-line text for a thrown value.
 *
 * @param {unknown} error - The thrown value.
 * @returns {string} The message, without a stack.
 */
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Makes the report for a stop-gate crash.
 *
 * @param {unknown} error - The thrown value.
 * @param {number} attempt - Number of this blocked stop.
 * @returns {string} Text for Claude.
 */
function crashReport(error, attempt) {
  const text = errorText(error);
  const tail = attempt >= STOP_ATTEMPT_LIMIT ? `\n\n${LAST_RETRY}` : '';
  return `STOP BLOCKED: the stop-gate could not finish its checks.\n\n${text}\n\nA human must fix the cause (a git or file-system problem in the repo or in .claude/state). Do not say the work is done.${tail}`;
}

runHook(
  (context) => {
    if (WRITE_STATE_ONLY) {
      try {
        return writeStateOnly(context);
      } catch (error) {
        return {
          exitCode: 1,
          stderr: `stop-gate could not finish its checks: ${errorText(error)}`,
        };
      }
    }
    if (FAST) {
      try {
        return fastGate(context);
      } catch (error) {
        return blockWith(crashReport(error, 1));
      }
    }
    return stopGate(context);
  },
  { failClosed: true, name: 'stop-gate', readInput: !WRITE_STATE_ONLY },
);
