// Prettier check for committed changes (see lib/prettier-check.mjs). scripts/gates/local-gates.sh
// runs it after gate lint and before `rush verify`.
import { formatBase, resolveGatesBase } from './lib/gates-base.mjs';
import { readEnv } from './lib/gates.config.mjs';
import { repositoryRoot } from './lib/git-state.mjs';
import { PRETTIER_BIN, runPrettierGate } from './lib/prettier-check.mjs';
import { resolveCommit } from './lib/revisions.mjs';

const HELP = `prettier-check: run "prettier --list-different" on the files that changed since a base.

Usage:
  node scripts/gates/prettier-check.mjs [--base <commit>] [--root <dir>]

  --base <commit>  check the files that committed changes base...HEAD added or changed. Default:
                   the base of scripts/gates/gates-base.mjs (GATES_BASE, origin/main, the upstream,
                   the state file, the root commit).
Files: tracked regular files with an extension that .lintstagedrc.cjs formats (ts tsx js jsx mjs cjs
json jsonc yml yaml css), plus md. Files that the root .gitignore or .prettierignore match are not
checked. Deleted files are not checked; a renamed file is checked with its new path.
Env: GATES_FULL=1 checks every tracked file.
Prettier: ${PRETTIER_BIN} (the rush-lint-staged autoinstaller).

Output: "prettier: pass (<n> files)", or the files that are not formatted and the fix command.
Exit code: 0, 1 when a file is not formatted or Prettier cannot run, 2 for bad usage or a base that
cannot be found.
`;

/**
 * Reads the command line.
 *
 * @param {string[]} argv - Arguments after the script name.
 * @returns {{ options: Record<string, string | boolean>, error: string }} Parsed flags.
 */
function parseArguments(argv) {
  /** @type {Record<string, string | boolean>} */
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const word = argv[index] ?? '';
    const value = argv[index + 1];
    if ((word === '--base' || word === '--root') && value !== undefined) {
      options[word.slice(2)] = value;
      index += 1;
    } else if (word === '--help' || word === '-h') {
      options['help'] = true;
    } else {
      return { options, error: `bad argument: ${word}` };
    }
  }
  return { options, error: '' };
}

/**
 * Finds the repo root and the base commit.
 *
 * @param {Record<string, string | boolean>} options - Parsed flags.
 * @returns {{ root: string, base: string }} Repo root and base commit id. It throws when the base
 *   cannot be found.
 */
function resolveInputs(options) {
  const root = repositoryRoot(
    typeof options['root'] === 'string' ? options['root'] : process.cwd(),
  );
  if (typeof options['base'] === 'string') {
    return { root, base: resolveCommit(root, options['base']) };
  }
  const found = resolveGatesBase(root, { envBase: readEnv('GATES_BASE') });
  process.stderr.write(`${formatBase(found)}\n`);
  return { root, base: found.sha };
}

/**
 * Runs the command.
 *
 * @param {string[]} argv - Arguments after the script name.
 * @returns {number} Exit code.
 */
export function main(argv) {
  const { options, error } = parseArguments(argv);
  if (options['help'] === true) {
    process.stdout.write(HELP);
    return 0;
  }
  if (error !== '') {
    process.stderr.write(`${error}\n\n${HELP}`);
    return 2;
  }
  let inputs;
  try {
    inputs = resolveInputs(options);
  } catch (caught) {
    // A base that cannot be found must never turn into "no files changed".
    process.stderr.write(
      `prettier: no base: ${caught instanceof Error ? caught.message : String(caught)}\n`,
    );
    return 2;
  }
  try {
    return runPrettierGate({
      ...inputs,
      full: readEnv('GATES_FULL') === '1',
      write: (text) => process.stdout.write(text),
      writeError: (text) => process.stderr.write(text),
    });
  } catch (caught) {
    process.stderr.write(
      `prettier: FAIL ${caught instanceof Error ? caught.message : String(caught)}\n`,
    );
    return 1;
  }
}

if (import.meta.filename === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}
