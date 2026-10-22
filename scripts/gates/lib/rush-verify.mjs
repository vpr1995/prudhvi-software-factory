import { RUSH_TIMEOUT_MS } from './gates.config.mjs';
import { clipLines, stripAnsi } from './hook-io.mjs';
import { run } from './proc.mjs';

const FAILURE_HEADER = /^--\[ FAILURE: (.+) \((\w[\w:-]*)\) \]-/;
const BLOCK_END = /^(?:--\[|==\[|Operations failed)/;
const BLOCK_LINES = 40;

/**
 * @typedef {object} Check
 * @property {string} name - Check name.
 * @property {'pass' | 'fail' | 'skip'} status - Result. A skip never fails the gate.
 * @property {string} detail - Output to show when the check fails, or why it was skipped.
 * @property {boolean} [degraded] - True when a required scanner did not run (missing tool or a
 *   run error). The verify state then says `pass-with-skips`, and CI counts it as a failure.
 */

/**
 * Splits Rush output into one block per failed operation.
 *
 * @param {string} output - Rush output without color codes.
 * @returns {{ project: string, phase: string, log: string }[]} The failed operations.
 */
export function parseRushFailures(output) {
  const failures = [];
  let current = null;
  for (const line of output.split('\n')) {
    const header = FAILURE_HEADER.exec(line);
    if (header !== null) {
      current = { project: header[1] ?? '', phase: header[2] ?? '', lines: [] };
      failures.push(current);
    } else if (current !== null && BLOCK_END.test(line)) {
      current = null;
    } else if (current !== null) {
      current.lines.push(line);
    }
  }
  return failures.map((failure) => ({
    project: failure.project,
    phase: failure.phase,
    log: clipLines(failure.lines.join('\n').trim(), BLOCK_LINES),
  }));
}

/**
 * Runs `rush verify` and turns the output into checks.
 *
 * @param {string} root - Repo root.
 * @param {string[]} projects - Package names to verify with their dependents. Empty means all projects.
 * @returns {Check[]} One check per failed operation, or one passing check.
 */
export function runRushVerify(root, projects) {
  const selection = projects.flatMap((name) => ['--from', name]);
  const result = run(
    process.execPath,
    ['common/scripts/install-run-rush.js', 'verify', ...selection],
    {
      cwd: root,
      timeoutMs: RUSH_TIMEOUT_MS,
    },
  );
  const output = stripAnsi(`${result.stdout}\n${result.stderr}`);
  const label =
    projects.length === 0 ? 'rush verify (all projects)' : 'rush verify (impacted projects)';
  if (result.status === 0) {
    return [{ name: label, status: 'pass', detail: '' }];
  }
  const failures = parseRushFailures(output);
  if (failures.length === 0) {
    const note = result.timedOut ? 'Rush ran out of time.\n' : '';
    return [
      {
        name: label,
        status: 'fail',
        detail: `${note}${clipLines(output.trim().split('\n').slice(-60).join('\n'), BLOCK_LINES)}`,
      },
    ];
  }
  return failures.map((failure) => ({
    name: `${failure.phase.replace(/^_phase:/, '')}: ${failure.project}`,
    status: 'fail',
    detail: failure.log,
  }));
}
