// Keeps the logs of a failed step of scripts/gates/local-gates.sh (see lib/failure-logs.mjs).
import { keepFailureLogs, keptMessage } from './lib/failure-logs.mjs';
import { repositoryRoot } from './lib/git-state.mjs';

const HELP = `keep-failure-logs: copy the rush-logs and test-results folders after a failed gate step.

Usage:
  node scripts/gates/keep-failure-logs.mjs --step <name> [--note <text>]

  --step <name>   the failed step. Its slug is part of the folder name.
  --note <text>   extra text for failure.txt, for example the exit code.

It copies every projects/*/rush-logs, packages/*/rush-logs, platform/*/rush-logs, tooling/*/rush-logs
and projects/*/test-results folder to .claude/state/failure-logs/<UTC yyyymmddThhmmssZ>-<step>/,
and keeps the newest 10 folders. It prints: Logs kept in <path>. Read them before you rerun.
Exit code: 0 kept, 1 the copy failed, 2 bad usage.
`;

const VALUE_FLAGS = new Set(['--step', '--note']);

/**
 * Reads the command line.
 *
 * @param {string[]} argv - Arguments after the script name.
 * @returns {{ options: Record<string, string>, help: boolean, error: string }} Parsed flags.
 */
function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const word = argv[index] ?? '';
    const value = argv[index + 1];
    if (word === '--help' || word === '-h') {
      return { options, help: true, error: '' };
    }
    if (!VALUE_FLAGS.has(word) || value === undefined) {
      return { options, help: false, error: `bad argument: ${word}` };
    }
    options[word.slice(2)] = value;
    index += 1;
  }
  const error = (options['step'] ?? '') === '' ? '--step is required' : '';
  return { options, help: false, error };
}

/**
 * Runs the command.
 *
 * @param {string[]} argv - Arguments after the script name.
 * @returns {number} Exit code.
 */
export function main(argv) {
  const { options, help, error } = parseArguments(argv);
  if (help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (error !== '') {
    process.stderr.write(`keep-failure-logs: ${error}\n\n${HELP}`);
    return 2;
  }
  try {
    const folder = keepFailureLogs(repositoryRoot(process.cwd()), {
      step: options['step'] ?? '',
      report: options['note'] ?? '',
    });
    process.stdout.write(`${keptMessage(folder)}\n`);
    return 0;
  } catch (caught) {
    const reason = caught instanceof Error ? caught.message : String(caught);
    process.stderr.write(`keep-failure-logs: the logs were not kept: ${reason}\n`);
    return 1;
  }
}

if (import.meta.filename === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}
