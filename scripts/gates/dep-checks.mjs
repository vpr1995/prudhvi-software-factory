// Prints the plan of the dependency checks for scripts/gates/local-gates.sh (see lib/dep-checks.mjs).
import { formatPlan, planForRepository } from './lib/dep-checks.mjs';
import { readEnv } from './lib/gates.config.mjs';
import { repositoryRoot } from './lib/git-state.mjs';

const HELP = `dep-checks: plan the license checks, the typosquat check and the audits of the local gate run.

Usage:
  node scripts/gates/dep-checks.mjs --base <commit> [--root <dir>]
  node scripts/gates/dep-checks.mjs --audit-only [--root <dir>]

  --base <commit>  license checks run when a lock or the license policy changed since the commit
                   (committed, staged, unstaged and untracked changes). The typosquat check
                   (scripts/gates/typosquat-check.mjs) runs when a package.json under projects/,
                   packages/, platform/, tooling/ or a rush.json project folder gained a dependency
                   name, or gained or changed a dependency version, since the commit; it
                   prints no line when none did. An audit runs when its lock changed: rush audit for
                   common/config/rush/pnpm-lock.yaml, pip-audit for projects/<name>/src/api-py/uv.lock,
                   govulncheck for projects/<name>/src/api-go/go.sum. The audits of unchanged locks skip.
  --audit-only     the audits only (rush audit, pip-audit, govulncheck), every one of them.
Env: GATES_FULL=1 runs every license check, the typosquat check and every audit.

Output: one line for each check, fields split by tabs:
  run<TAB>label<TAB>reason<TAB>command words...
  skip<TAB>label<TAB>reason
Exit code: 0, or 2 for bad usage or a change that cannot be read.
`;

const VALUE_FLAGS = new Set(['--base', '--root']);

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
    const value = argv[index + 1];
    if (VALUE_FLAGS.has(word) && value !== undefined) {
      options[word.slice(2)] = value;
      index += 1;
    } else if (['--audit-only', '--help', '-h'].includes(word)) {
      options[word.replace(/^-+/, '')] = true;
    } else {
      return { options, error: `bad argument: ${word}` };
    }
  }
  if (options['audit-only'] !== true && typeof options['base'] !== 'string') {
    return { options, error: '--base is required without --audit-only' };
  }
  return { options, error: '' };
}

/**
 * Runs the command.
 *
 * @param {string[]} argv - Arguments after the script name.
 * @returns {number} Exit code.
 */
export function main(argv) {
  const { options, error } = parseArguments(argv);
  if (options['help'] === true || options['h'] === true) {
    process.stdout.write(HELP);
    return 0;
  }
  if (error !== '') {
    process.stderr.write(`${error}\n\n${HELP}`);
    return 2;
  }
  try {
    const root = repositoryRoot(
      typeof options['root'] === 'string' ? options['root'] : process.cwd(),
    );
    const plan = planForRepository(root, {
      base: typeof options['base'] === 'string' ? options['base'] : '',
      full: readEnv('GATES_FULL') === '1',
      auditOnly: options['audit-only'] === true,
    });
    process.stdout.write(formatPlan(plan));
    return 0;
  } catch (caught) {
    // A change that cannot be read must never turn into "no license check needed".
    process.stderr.write(
      `dep-checks: could not plan: ${caught instanceof Error ? caught.message : String(caught)}\n`,
    );
    return 2;
  }
}

if (import.meta.filename === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}
