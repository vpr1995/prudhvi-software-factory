import { spawnSync } from 'node:child_process';

import { childEnv } from './gates.config.mjs';

const MEGABYTE = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_BUFFER_MEGABYTES = 128;

/**
 * @typedef {object} RunResult
 * @property {number} status - Exit code. 127 when the program did not start, 124 on timeout.
 * @property {string} stdout - Standard output.
 * @property {string} stderr - Standard error.
 * @property {boolean} started - False when the program was not found.
 * @property {boolean} timedOut - True when the timeout stopped it.
 */

/**
 * @typedef {object} RunOptions
 * @property {string} [cwd] - Working folder.
 * @property {string} [input] - Text for stdin.
 * @property {number} [timeoutMs] - Time limit in milliseconds.
 * @property {Record<string, string>} [env] - Extra variables.
 */

/**
 * Runs a program with no shell.
 *
 * @param {string} program - Program name or path.
 * @param {readonly string[]} args - Arguments.
 * @param {RunOptions} [options] - Options.
 * @returns {RunResult} The result. It never throws.
 */
export function run(program, args, options = {}) {
  const result = spawnSync(program, args, {
    cwd: options.cwd,
    input: options.input,
    encoding: 'utf8',
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER_MEGABYTES * MEGABYTE,
    env: childEnv(options.env),
  });
  const errorCode = result.error && 'code' in result.error ? result.error.code : undefined;
  const timedOut = errorCode === 'ETIMEDOUT';
  const started = errorCode !== 'ENOENT';
  const fallbackStatus = started ? 1 : 127;
  const status = timedOut ? 124 : (result.status ?? fallbackStatus);
  return { status, stdout: result.stdout, stderr: result.stderr, started, timedOut };
}

/**
 * Runs a program with no shell and returns its output as bytes.
 *
 * @param {string} program - Program name or path.
 * @param {readonly string[]} args - Arguments.
 * @param {RunOptions} [options] - Options.
 * @returns {{ status: number, stdout: Buffer, stderr: string }} The result. It never throws.
 */
export function runBinary(program, args, options = {}) {
  const result = spawnSync(program, args, {
    cwd: options.cwd,
    input: options.input,
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER_MEGABYTES * MEGABYTE,
    env: childEnv(options.env),
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? Buffer.alloc(0),
    stderr: (result.stderr ?? Buffer.alloc(0)).toString('utf8'),
  };
}

/**
 * Finds a program on PATH (plus the usual user tool folders).
 *
 * @param {string} name - Program name.
 * @returns {string | null} Full path, or null when it is not installed.
 */
export function which(name) {
  const result = run('sh', ['-c', 'command -v "$1"', 'sh', name], { timeoutMs: 10_000 });
  const first = result.stdout.split('\n')[0]?.trim() ?? '';
  return result.status === 0 && first.length > 0 ? first : null;
}

/**
 * Runs git.
 *
 * @param {string} root - Repository folder.
 * @param {readonly string[]} args - Git arguments.
 * @param {RunOptions} [options] - Options.
 * @returns {RunResult} The result.
 */
export function git(root, args, options = {}) {
  return run('git', ['-c', 'core.quotepath=false', ...args], { ...options, cwd: root });
}

/**
 * Runs git and throws when it fails. A failing git command must never look like "no changes".
 *
 * @param {string} root - Repository folder.
 * @param {readonly string[]} args - Git arguments.
 * @param {RunOptions} [options] - Options.
 * @returns {RunResult} The result of a successful run.
 */
export function gitOrThrow(root, args, options = {}) {
  const result = git(root, args, options);
  if (result.status !== 0) {
    throw new Error(
      `git ${args.slice(0, 3).join(' ')} failed (exit ${String(result.status)}): ${result.stderr.trim().slice(0, 300)}`,
    );
  }
  return result;
}
