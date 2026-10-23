// cdk synth for changed infra (see lib/synth-changed.mjs). scripts/gates/local-gates.sh runs it
// after `rush verify`, because the CDK apps import the built shared packages.
import { formatBase, resolveGatesBase } from './lib/gates-base.mjs';
import { readEnv } from './lib/gates.config.mjs';
import { repositoryRoot } from './lib/git-state.mjs';
import { resolveCommit } from './lib/revisions.mjs';
import { runSynthGate } from './lib/synth-changed.mjs';

const HELP = `synth-changed: run an offline "cdk synth --quiet" for each CDK app that changed.

Usage:
  node scripts/gates/synth-changed.mjs [--base <commit>] [--root <dir>]

  --base <commit>  compare committed changes base...HEAD. Default: the base of
                   scripts/gates/gates-base.mjs (GATES_BASE, origin/main, the upstream, the state
                   file, the root commit).
Apps: projects/<name> and platform/infra folders with a cdk.json. An app is affected by changes
under its bin/, lib/ (and src/ for a project), its cdk.json, package.json and build tsconfig,
packages/cdk-constructs/src/ or its package.json, or common/config/rush/pnpm-lock.yaml.
Env: GATES_FULL=1 makes every app affected ("synth: <app> forced (GATES_FULL=1)").
Each affected app synths once for each environment in lib/config/config.ts ("-c env=<name>"), with
Rush's pnpm first on PATH, no AWS credentials, and the output in a temp folder.

Output: "synth: PASS <app> env=<env> (<secs>s)" or "synth: SKIP <app> (no infra change since <base>)".
Exit code: 0, 1 when a synth fails or the bundle hooks leave a file at the repo root, 2 for bad
usage or a base that cannot be found.
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
    // A base that cannot be found must never turn into "no infra changed".
    process.stderr.write(
      `synth: no base: ${caught instanceof Error ? caught.message : String(caught)}\n`,
    );
    return 2;
  }
  try {
    return runSynthGate({
      ...inputs,
      full: readEnv('GATES_FULL') === '1',
      write: (text) => process.stdout.write(text),
      writeError: (text) => process.stderr.write(text),
    });
  } catch (caught) {
    process.stderr.write(
      `synth: FAIL ${caught instanceof Error ? caught.message : String(caught)}\n`,
    );
    return 1;
  }
}

if (import.meta.filename === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}
