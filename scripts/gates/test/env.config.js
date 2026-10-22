// The only test helper that reads process.env (the repo lint rule allows it in *.config.* files).

/**
 * Builds the environment for a child process.
 *
 * @param {Record<string, string>} [extra] - Variables to add.
 * @returns {Record<string, string | undefined>} The environment.
 */
export function environmentWith(extra = {}) {
  return { ...process.env, ...extra };
}
