// The only gate module that reads `process.env`. Everything else asks this file.
import os from 'node:os';

const EXTRA_BIN_DIRECTORIES = ['.local/bin', 'go/bin', '.cargo/bin'];
const SYSTEM_BIN_DIRECTORIES = ['/usr/local/bin', '/opt/homebrew/bin'];

/**
 * Reads one environment variable.
 *
 * @param {string} name - Variable name.
 * @returns {string | undefined} The value, or undefined.
 */
export function readEnv(name) {
  return process.env[name];
}

/**
 * Builds the environment for a child process. Hook children get a PATH that also holds the
 * usual user tool folders, because a hook can start with a short PATH.
 *
 * @param {Record<string, string>} [extra] - Variables to add or replace.
 * @returns {Record<string, string | undefined>} Environment for `spawnSync`.
 */
export function childEnv(extra = {}) {
  const home = os.homedir();
  const extraDirectories = [
    ...EXTRA_BIN_DIRECTORIES.map((entry) => `${home}/${entry}`),
    ...SYSTEM_BIN_DIRECTORIES,
  ];
  const current = process.env['PATH'] ?? '';
  return { ...process.env, PATH: [current, ...extraDirectories].join(':'), ...extra };
}

/**
 * Tells whether the process runs in CI.
 *
 * @returns {boolean} True when `CI=true`.
 */
export function isCi() {
  return process.env['CI'] === 'true';
}

/**
 * Picks the project root the hooks work on.
 *
 * @param {string | undefined} payloadCwd - The `cwd` field of the hook input.
 * @returns {string} `CLAUDE_PROJECT_DIR`, else the hook `cwd`, else the process cwd.
 */
export function startDirectory(payloadCwd) {
  return process.env['CLAUDE_PROJECT_DIR'] ?? payloadCwd ?? process.cwd();
}

/**
 * Pinned versions of tools that run through `go run`. A human changes them.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const GO_TOOLS = Object.freeze({
  gofumpt: 'mvdan.cc/gofumpt@v0.9.2',
  goimports: 'golang.org/x/tools/cmd/goimports@v0.38.0',
});

export const STOP_ATTEMPT_LIMIT = 3;

export const MAX_REPORT_LINES = 40;

export const RUSH_TIMEOUT_MS = 3_000_000;
