// Line rules for ways to make a test run exit zero, or to drop tests from the run, without a skip
// call: a swallowed test command, a Go build tag in a test file, a pytest exit hook. The scanner
// skips scripts/gates/** (see gate-files.json), so these sources do not flag themselves.

/** @typedef {import('./anti-skip-rules.mjs').LineRule} LineRule */

// A test command followed by something that makes the script succeed when the tests fail.
// `|| echo` is allowed when the same line still exits non-zero (`|| echo failed; exit 1`).

/** @type {readonly LineRule[]} */
export const EXIT_AND_BUILD_RULES = [
  {
    id: 'test-failure-swallowed',
    languages: ['config'],
    files: /\.(?:sh|bash)$/,
    pattern:
      /\b(?:go\s+test|pytest|vitest|bru\s+run)\b[^\n]*?(?:\|\|\s*(?:echo\b(?![^\n]*\bexit\s+[1-9])|true\b|:(?:\s|$|[;&)"'|]))|;\s*true\b)/,
    message:
      'adds "|| echo", "|| true", "|| :" or "; true" after a test command (go test, pytest, vitest, bru run), which hides a failing test',
  },
  {
    id: 'test-failure-swallowed',
    languages: ['config'],
    files: /(?:^|\/)package\.json$/,
    pattern:
      /"_phase:[^"]*"\s*:\s*"[^"]*\b(?:go\s+test|pytest|vitest|bru\s+run)\b[^\n]*?(?:\|\|\s*(?:echo\b(?![^\n]*\bexit\s+[1-9])|true\b|:(?:\s|$|[;&)"'|]))|;\s*true\b)/,
    message:
      'adds "|| echo", "|| true", "|| :" or "; true" after a test command in a _phase script, which hides a failing test',
  },
  {
    id: 'go-test-build-tag',
    languages: ['go'],
    files: /_test\.go$/,
    pattern: /^\s*\/\/\s*(?:go:build|\+build)\b/,
    message:
      'adds a build constraint to a Go test file, which can hide its tests from "go test ./..."',
  },
  {
    id: 'py-exit-hook',
    languages: ['py'],
    pattern: /\bpytest_sessionfinish\b|\bpytest_terminal_summary\b|\bexitstatus\s*=(?!=)/,
    message:
      'adds a pytest hook or an exit status assignment that can change the pytest exit code (pytest_sessionfinish, pytest_terminal_summary, exitstatus =)',
  },
];
