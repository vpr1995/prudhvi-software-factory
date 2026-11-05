// Command line for `rush new`. Rush adds the "--library" parameter to the shell command.
import { parseArgs } from 'node:util';

import { KINDS, scaffold } from './scaffold.js';

/**
 * @typedef {object} CliContext
 * @property {string} root - Repo root.
 * @property {string} templatesFolder - Absolute path of tooling/templates.
 * @property {() => number} update - Runs `rush update`. Returns the exit code.
 * @property {(text: string) => void} out - Writes to stdout.
 * @property {(text: string) => void} err - Writes to stderr.
 * @property {Date} [now] - Time for the change file name.
 */

const USAGE = `Usage: rush new --library <name>`;

/**
 * Run `rush new`. Exactly one kind flag must be given.
 *
 * @param {string[]} argv - Arguments after the script name.
 * @param {CliContext} context - Paths and output functions.
 * @returns {Promise<number>} The exit code.
 */
export async function run(argv, context) {
  /** @type {Record<string, string | undefined>} */
  let values;
  try {
    const options = Object.fromEntries(
      Object.keys(KINDS).map((kind) => [kind, { type: /** @type {const} */ ('string') }]),
    );
    ({ values } = parseArgs({ args: argv, options, strict: true, allowPositionals: false }));
  } catch (error) {
    context.err(`rush new: ${error instanceof Error ? error.message : String(error)}\n${USAGE}\n`);
    return 1;
  }
  const given = Object.entries(values).filter(([, value]) => value !== undefined);
  if (given.length !== 1) {
    context.err(
      `rush new: give exactly one of ${Object.keys(KINDS)
        .map((kind) => `--${kind}`)
        .join(', ')}\n${USAGE}\n`,
    );
    return 1;
  }
  const [kind, name = ''] = given[0] ?? ['', ''];

  let result;
  try {
    result = await scaffold({
      root: context.root,
      templatesFolder: context.templatesFolder,
      kind,
      name,
      now: context.now,
    });
  } catch (error) {
    context.err(`rush new: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  context.out(
    `Created ${result.packageName}:\n${result.files.map((file) => `  ${file}\n`).join('')}`,
  );
  context.out('Running rush update...\n');
  const code = context.update();
  if (code !== 0) {
    context.err(
      `rush new: rush update failed (exit ${code}). The files stay. Fix the cause, then run rush update.\n`,
    );
    return code;
  }
  context.out(
    [
      'Next steps:',
      `  1. Write the code in ${result.folder}/src and the tests in ${result.folder}/test.`,
      `  2. Edit the description in ${result.folder}/package.json and ${result.folder}/README.md.`,
      `  3. Edit the comment in the change file under common/changes/${result.packageName}/.`,
      `  4. Run: rush verify --to ${result.packageName}`,
      '',
    ].join('\n'),
  );
  return 0;
}
