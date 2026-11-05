// Command lines for `rush new` and `rush add-part`. Rush adds the parameters to the shell command.
import { parseArgs } from 'node:util';

import { addPart, PARTS } from './add-part.js';
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

const USAGE = `Usage: rush new --library <name> | rush new --project <name>`;
const ADD_PART_USAGE = `Usage: rush add-part --project <name> --part <${Object.keys(PARTS).join('|')}>`;

/**
 * @param {string} kind - Key of KINDS.
 * @param {{ folder: string, packageName: string }} result - What `scaffold` made.
 * @returns {string[]} The next steps for the user.
 */
function nextSteps(kind, { folder, packageName }) {
  if (kind === 'project') {
    const name = folder.slice(folder.lastIndexOf('/') + 1);
    return [
      `  1. Add each part that the project needs: rush add-part --project ${name} --part <${Object.keys(PARTS).join('|')}>`,
      `  2. Edit the description in ${folder}/package.json and ${folder}/README.md.`,
      `  3. Run: rush verify --to ${packageName}`,
    ];
  }
  return [
    `  1. Write the code in ${folder}/src and the tests in ${folder}/test.`,
    `  2. Edit the description in ${folder}/package.json and ${folder}/README.md.`,
    `  3. Edit the comment in the change file under common/changes/${packageName}/.`,
    `  4. Run: rush verify --to ${packageName}`,
  ];
}

/**
 * Write what was made, run `rush update`, and report its result.
 *
 * @param {{ command: string, title: string, files: string[] }} made - Command name for messages, first line of the report, and the paths that were written.
 * @param {CliContext} context - Paths and output functions.
 * @returns {number} The exit code of `rush update`.
 */
function report({ command, title, files }, context) {
  context.out(`${title}\n${files.map((file) => `  ${file}\n`).join('')}`);
  context.out('Running rush update...\n');
  const code = context.update();
  if (code !== 0) {
    context.err(
      `${command}: rush update failed (exit ${code}). The files stay. Fix the cause, then run rush update.\n`,
    );
  }
  return code;
}

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
  const code = report(
    { command: 'rush new', title: `Created ${result.packageName}:`, files: result.files },
    context,
  );
  if (code !== 0) return code;
  context.out(['Next steps:', ...nextSteps(kind, result), ''].join('\n'));
  return 0;
}

/**
 * Run `rush add-part`. Both parameters are required.
 *
 * @param {string[]} argv - Arguments after the script name.
 * @param {CliContext} context - Paths and output functions.
 * @returns {Promise<number>} The exit code.
 */
export async function runAddPart(argv, context) {
  /** @type {{ project?: string | undefined, part?: string | undefined }} */
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: { project: { type: 'string' }, part: { type: 'string' } },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    context.err(
      `rush add-part: ${error instanceof Error ? error.message : String(error)}\n${ADD_PART_USAGE}\n`,
    );
    return 1;
  }
  const { project, part } = values;
  if (project === undefined || part === undefined) {
    context.err(`rush add-part: give --project and --part\n${ADD_PART_USAGE}\n`);
    return 1;
  }

  let result;
  try {
    result = await addPart({
      root: context.root,
      templatesFolder: context.templatesFolder,
      project,
      part,
    });
  } catch (error) {
    context.err(`rush add-part: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  const code = report(
    {
      command: 'rush add-part',
      title: `Added the ${part} part to ${result.packageName}:`,
      files: result.files,
    },
    context,
  );
  if (code !== 0) return code;
  context.out(
    [
      'Next steps:',
      ...result.nextSteps.map((step, index) => `  ${String(index + 1)}. ${step}`),
      `  ${String(result.nextSteps.length + 1)}. Run: rush verify --to ${result.packageName}`,
      '',
    ].join('\n'),
  );
  return 0;
}
