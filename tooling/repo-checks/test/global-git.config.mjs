// Env access for the tests: run a function with a global git config file (GIT_CONFIG_GLOBAL).
// Lint allows process.env only in config files.

/**
 * @param {string} file - Path of the global git config file.
 * @param {() => T} run - Function to run.
 * @returns {T} The result of run.
 * @template T
 */
export function withGlobalGitConfig(file, run) {
  const previous = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = file;
  try {
    return run();
  } finally {
    if (previous === undefined) {
      delete process.env.GIT_CONFIG_GLOBAL;
    } else {
      process.env.GIT_CONFIG_GLOBAL = previous;
    }
  }
}
