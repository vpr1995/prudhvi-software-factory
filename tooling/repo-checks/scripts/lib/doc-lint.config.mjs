// Env access for scripts/doc-lint.mjs. Lint allows process.env only in config files.

/** @returns {boolean} True when the script runs in GitHub Actions. */
export function isGithubActions() {
  return process.env.GITHUB_ACTIONS === 'true';
}
