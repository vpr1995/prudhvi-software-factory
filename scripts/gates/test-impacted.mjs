// Runs only the gate tests that a change can affect (see lib/test-impact.mjs for the rules).
import { spawnSync } from 'node:child_process';

import { childEnv } from './lib/gates.config.mjs';
import { repositoryRoot } from './lib/git-state.mjs';
import { changedPaths, listTests, selectTests } from './lib/test-impact.mjs';

const HELP = `test-impacted: run the gate tests that a change can affect.

Usage:
  node scripts/gates/test-impacted.mjs [--base <ref> [--head <ref>]] [--list] [--all] [--root <dir>]

Changes:
  (no flag)         the working tree against HEAD, with untracked files.
  --base <ref>      the working tree (with untracked files) against the merge base of <ref> and HEAD.
  --base <ref> --head <ref>
                    the range <ref>...<ref>. Run it in a checkout of --head: the test graph is read from the working tree.
Options:
  --list            print the selected test files, one for each line, and do not run them.
  --all             select every test file.
  --root <dir>      repo root. Default: the git root of the current folder.
  --help            show this text.

Every test file runs when the change touches something that the import graph cannot see (the gate
list, the hook wrappers, the git hooks, a test helper that no test names), or when the graph cannot
be built. The reason goes to stderr. Exit code: the exit code of node --test. 2 for bad usage or a
change that cannot be read. With no selected test: "no gate tests affected" and exit 0.
`;

const VALUE_FLAGS = new Set(['--base', '--head', '--root']);
const SWITCH_FLAGS = new Set(['--list', '--all', '--help', '-h']);
const MAX_REASONS_SHOWN = 3;

/**
 * Reads the command line.
 *
 * @param {string[]} argv - Arguments after the script name.
 * @returns {{ options: Record<string, string | boolean>, error: string }} Parsed flags.
 */
function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const word = argv[index] ?? '';
    if (VALUE_FLAGS.has(word)) {
      const value = argv[index + 1];
      if (value === undefined) {
        return { options, error: `missing value for ${word}` };
      }
      options[word.slice(2)] = value;
      index += 1;
    } else if (SWITCH_FLAGS.has(word)) {
      options[word.replace(/^-+/, '')] = true;
    } else {
      return { options, error: `unknown argument: ${word}` };
    }
  }
  if (options['head'] !== undefined && options['base'] === undefined) {
    return { options, error: '--head needs --base' };
  }
  return { options, error: '' };
}

/**
 * Picks the tests for the command line.
 *
 * @param {string} root - Repo root.
 * @param {Record<string, string | boolean>} options - Parsed flags.
 * @returns {import('./lib/test-impact.mjs').Selection} The selection.
 */
function choose(root, options) {
  if (options['all'] === true) {
    return { mode: 'all', files: listTests(root), reasons: ['--all'] };
  }
  const { files, headIsCheckedOut } = changedPaths(root, {
    base: typeof options['base'] === 'string' ? options['base'] : undefined,
    head: typeof options['head'] === 'string' ? options['head'] : undefined,
  });
  if (!headIsCheckedOut) {
    return {
      mode: 'all',
      files: listTests(root),
      reasons: ['--head is not the checked-out commit, so the working tree is not the graph'],
    };
  }
  return { ...selectTests({ root, changed: files }), changedCount: files.length };
}

/**
 * Builds the environment of the test run. A run inside another `node --test` run (a test that calls
 * this script) must be a fresh run with its own report, so the variable that marks a child run is
 * removed.
 *
 * @returns {Record<string, string | undefined>} The environment for `spawnSync`.
 */
function freshTestEnvironment() {
  return Object.fromEntries(
    Object.entries(childEnv()).filter(([name]) => name !== 'NODE_TEST_CONTEXT'),
  );
}

/**
 * Runs the command.
 *
 * @param {string[]} argv - Arguments after the script name.
 * @returns {number} Exit code.
 */
export function main(argv) {
  const { options, error } = parseArguments(argv);
  if (error !== '') {
    process.stderr.write(`${error}\n\n${HELP}`);
    return 2;
  }
  if (options['help'] === true || options['h'] === true) {
    process.stdout.write(HELP);
    return 0;
  }
  let selection;
  let root;
  try {
    root = repositoryRoot(typeof options['root'] === 'string' ? options['root'] : process.cwd());
    selection = choose(root, options);
  } catch (caught) {
    // A change that cannot be read must never look like "no test affected".
    process.stderr.write(
      `test-impacted: could not select tests: ${caught instanceof Error ? caught.message : String(caught)}\n`,
    );
    return 2;
  }
  if (selection.mode === 'none') {
    process.stdout.write('no gate tests affected\n');
    return 0;
  }
  if (selection.mode === 'all') {
    const shown = selection.reasons.slice(0, MAX_REASONS_SHOWN);
    const more = selection.reasons.length - shown.length;
    process.stderr.write(
      `test-impacted: all ${String(selection.files.length)} test files. Reason: ${shown.join('; ')}${more > 0 ? `; and ${String(more)} more` : ''}\n`,
    );
  } else {
    process.stderr.write(`test-impacted: ${String(selection.files.length)} test files selected\n`);
  }
  if (options['list'] === true) {
    process.stdout.write(`${selection.files.join('\n')}\n`);
    return 0;
  }
  const result = spawnSync(process.execPath, ['--test', ...selection.files], {
    cwd: root,
    stdio: 'inherit',
    env: freshTestEnvironment(),
  });
  return result.status ?? 1;
}

if (import.meta.filename === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}
