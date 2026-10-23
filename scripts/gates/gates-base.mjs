// Prints the base commit of the local gate run (see lib/gates-base.mjs for the order).
// scripts/gates/local-gates.sh reads stdout. The log line goes to stderr.
import { formatBase, resolveGatesBase } from './lib/gates-base.mjs';
import { readEnv } from './lib/gates.config.mjs';
import { repositoryRoot } from './lib/git-state.mjs';

const HELP = `gates-base: print the base commit of the local gate run.

Usage:
  node scripts/gates/gates-base.mjs [--root <dir>]

Order: GATES_BASE (env), the merge base of origin/main and HEAD, the merge base of the upstream of
the current branch and HEAD, .claude/state/gates-base, the root commit of HEAD.

Output: "<sha> <source>" on stdout (source: env, origin, upstream, state or root), and the line
"gates: base <sha> (<source>: <detail>)" on stderr.
Exit code: 0, or 2 when GATES_BASE or the state file is set to a value that is not a commit, or
when there is no commit.
`;

/**
 * Runs the command.
 *
 * @param {string[]} argv - Arguments after the script name.
 * @returns {number} Exit code.
 */
export function main(argv) {
  let start = process.cwd();
  for (let index = 0; index < argv.length; index += 1) {
    const word = argv[index] ?? '';
    if (word === '--help' || word === '-h') {
      process.stdout.write(HELP);
      return 0;
    }
    const value = argv[index + 1];
    if (word !== '--root' || value === undefined) {
      process.stderr.write(`unknown argument: ${word}\n\n${HELP}`);
      return 2;
    }
    start = value;
    index += 1;
  }
  try {
    const base = resolveGatesBase(repositoryRoot(start), { envBase: readEnv('GATES_BASE') });
    process.stderr.write(`${formatBase(base)}\n`);
    process.stdout.write(`${base.sha} ${base.source}\n`);
    return 0;
  } catch (caught) {
    // A base that cannot be found must never turn into a smaller diff.
    process.stderr.write(
      `gates: no base: ${caught instanceof Error ? caught.message : String(caught)}\n`,
    );
    return 2;
  }
}

if (import.meta.filename === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}
