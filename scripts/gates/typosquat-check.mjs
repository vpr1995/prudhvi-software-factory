// Fails when a package.json gained a dependency name that looks like a known name, or gained or changed
// a dependency version that is not a plain registry version (see lib/typosquat.mjs).
import { changedSinceBase } from './lib/dep-checks.mjs';
import { repositoryRoot } from './lib/git-state.mjs';
import { checkTyposquats, formatProblem } from './lib/typosquat.mjs';

const HELP = `typosquat-check: stop a new dependency name that looks like a known package name, and a dependency version that is not a registry version.

Usage:
  node scripts/gates/typosquat-check.mjs --base <commit> [--root <dir>]

  --base <commit>  compare the dependencies of every package.json under projects/, packages/,
                   platform/, tooling/ and the project folders of rush.json with the commit
                   (committed, staged, unstaged and untracked changes). Each name that the files
                   gained must be a known name, or be far from every known name. Known names:
                   scripts/gates/data/popular-npm-packages.json and every dependency name in the
                   repo at the commit. Each dependency that the files gained or changed must have a
                   registry version: no URL, git, tarball or npm: alias; file: and link: only inside
                   the repo; @vprprudhvi/* only with workspace:.
  --root <dir>     the repo (default: the current folder).
It reads no network. It runs in local-gates.sh when a package.json gained or changed a dependency,
and with GATES_FULL=1.

Exit code: 0 pass, 1 a name looks like a known name or a version is not allowed (stop and ask the
human), 2 bad usage, a file that cannot be read, or a rush.json project folder outside projects/,
packages/, platform/ and tooling/.
`;

const VALUE_FLAGS = new Set(['--base', '--root']);

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
  const error = (options['base'] ?? '') === '' ? '--base is required' : '';
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
    process.stderr.write(`typosquat-check: ${error}\n\n${HELP}`);
    return 2;
  }
  try {
    const root = repositoryRoot(options['root'] ?? process.cwd());
    const base = options['base'] ?? '';
    const { added, problems } = checkTyposquats(root, base, changedSinceBase(root, base));
    if (problems.length > 0) {
      process.stderr.write(`${problems.map((problem) => formatProblem(problem)).join('\n')}\n`);
      return 1;
    }
    process.stdout.write(`typosquat-check: pass (${String(added.length)} new dependency names)\n`);
    return 0;
  } catch (caught) {
    // A change that cannot be read must never turn into "no new dependency".
    process.stderr.write(
      `typosquat-check: could not check: ${caught instanceof Error ? caught.message : String(caught)}\n`,
    );
    return 2;
  }
}

if (import.meta.filename === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}
