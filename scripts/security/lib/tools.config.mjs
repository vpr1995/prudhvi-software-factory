// Env access for scripts/security/install-tools.mjs. Lint allows process.env only in config files.

/**
 * @param {string} name - Variable name.
 * @returns {string | undefined} The value, or undefined when not set.
 */
export function readEnv(name) {
  return process.env[name];
}
