import { parseShell, programName } from './shell-parse.mjs';

const CHECK_PROGRAMS = new Set([
  'vitest',
  'jest',
  'eslint',
  'tsc',
  'pytest',
  'ruff',
  'mypy',
  'playwright',
  'bru',
  'gitleaks',
  'opengrep',
  'prettier',
  'cdk',
  'rush',
  'rushx',
  'tox',
  'golangci-lint',
]);
const RUSH_SCRIPTS = /install-run-rush(?:x)?\.js$/;
const GO_CHECK_COMMANDS = new Set(['test', 'vet', 'build']);
const CHECK_SUBCOMMANDS = new Set([
  'test',
  'build',
  'lint',
  'typecheck',
  'verify',
  'e2e',
  'check',
  'run',
]);
const EXIT_CODE_PATTERN = /^Exit code (\d+)/;

/**
 * Tells whether a command line runs a test, build, lint, typecheck or scan tool.
 *
 * @param {string} command - The Bash command line.
 * @returns {boolean} True when it is a check command.
 */
export function isCheckCommand(command) {
  return parseShell(command).some((segment) => {
    const name = programName(segment);
    const operands = segment.argv.slice(1).filter((word) => !word.startsWith('-'));
    const first = operands[0] ?? '';
    if (name === 'node' && RUSH_SCRIPTS.test(first)) {
      return true;
    }
    if (name === 'go') {
      return GO_CHECK_COMMANDS.has(first);
    }
    if (['npm', 'pnpm', 'yarn', 'bun', 'uv', 'npx'].includes(name)) {
      return (
        CHECK_SUBCOMMANDS.has(first) ||
        CHECK_PROGRAMS.has(first) ||
        (first === 'run' && CHECK_SUBCOMMANDS.has(operands[1] ?? ''))
      );
    }
    return CHECK_PROGRAMS.has(name);
  });
}

/**
 * Gets the exit code of a failed Bash call from the hook input.
 *
 * @param {Record<string, any>} payload - Hook input.
 * @returns {number | null} The exit code, or null when the call did not fail.
 */
export function failedExitCode(payload) {
  if (payload['hook_event_name'] === 'PostToolUseFailure') {
    const error = typeof payload['error'] === 'string' ? payload['error'] : '';
    const match = EXIT_CODE_PATTERN.exec(error);
    return match === null ? 1 : Number.parseInt(match[1] ?? '1', 10);
  }
  const response = payload['tool_response'];
  if (response !== null && typeof response === 'object') {
    const code = response['exit_code'] ?? response['exitCode'] ?? response['returncode'];
    return typeof code === 'number' && code !== 0 ? code : null;
  }
  return null;
}
