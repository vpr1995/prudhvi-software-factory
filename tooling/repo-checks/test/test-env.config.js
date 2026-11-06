// Env access for the tests of scripts/test-guard.mjs. Lint allows process.env only in config files.

/** @returns {string | undefined} PATH, so the child processes find git and node. */
export function pathFromEnv() {
  return process.env.PATH;
}
