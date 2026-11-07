// Env access for scripts/deploy-plan.mjs. Lint allows process.env only in config files.

/** @returns {string} The GITHUB_OUTPUT file path, or an empty string outside GitHub Actions. */
export function githubOutputFile() {
  return process.env.GITHUB_OUTPUT ?? '';
}
