// Env access for scripts/test-guard.mjs. Lint allows process.env only in config files.

/** @returns {string} The base SHA from env BASE_SHA, or '' when it is not set. */
export function baseShaFromEnv() {
  return process.env.BASE_SHA ?? '';
}

/** @returns {string | undefined} The raw PR_LABELS value (a JSON array of label names). */
export function prLabelsFromEnv() {
  return process.env.PR_LABELS;
}

/** @returns {string} The path of the GitHub step summary file, or '' when it is not set. */
export function stepSummaryPath() {
  return process.env.GITHUB_STEP_SUMMARY ?? '';
}
