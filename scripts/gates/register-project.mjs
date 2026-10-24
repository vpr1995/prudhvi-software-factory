// Adds a project to the `projects` array of rush.json, or removes it. Agents run it, so a new project
// needs no human hand-off for rush.json (owner decision, 2026-10-23). This script is a gate file, so
// an agent cannot change what it does. The text edit and its check are in lib/rush-json-edit.mjs.
// The Stop hook still sees the rush.json change as a gate change: commit it with the project, and a
// human pushes it (docs/standards/gates.md, section 2.4).
import path from 'node:path';

import { inspectPath, readJson, readText, writeText } from './lib/fs-io.mjs';
import { repositoryRoot } from './lib/git-state.mjs';
import { addProject, PROJECT_NAME, projectEntry, removeProject } from './lib/rush-json-edit.mjs';

const NEXT_STEP = 'node common/scripts/install-run-rush.js update';
const HELP = `register-project: add a project to rush.json, or remove it.

Usage:
  node scripts/gates/register-project.mjs <name>
  node scripts/gates/register-project.mjs --remove <name>

  <name>     kebab-case, ${PROJECT_NAME.source}. The project folder is projects/<name>.
  --remove   remove the entry of projects/<name>. Nothing else changes.

Add needs projects/<name>/package.json with the name @vprprudhvi/<name>. It inserts
  { "packageName": "@vprprudhvi/<name>", "projectFolder": "projects/<name>",
    "shouldPublish": false, "tags": ["project/<name>"] }
in sorted position among the projects/ entries. Every comment and all other text of rush.json stay.
It refuses a duplicate, a bad name, and any result that changes more than that one entry.

Exit code: 0 done, 1 refused, 2 bad usage.
Next step after a change: ${NEXT_STEP}
`;

/**
 * Reads the command line.
 *
 * @param {string[]} argv - Arguments after the script name.
 * @returns {{ mode: 'add' | 'remove' | 'help', name: string, error: string }} The request.
 */
function parseArguments(argv) {
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) {
    return { mode: 'help', name: '', error: '' };
  }
  const remove = argv[0] === '--remove';
  const words = remove ? argv.slice(1) : argv;
  if (words.length !== 1 || (words[0] ?? '').startsWith('-')) {
    return { mode: 'help', name: '', error: 'give exactly one project name' };
  }
  const name = words[0] ?? '';
  if (!PROJECT_NAME.test(name)) {
    return {
      mode: 'help',
      name,
      error: `bad project name "${name}": use kebab-case that matches ${PROJECT_NAME.source}`,
    };
  }
  return { mode: remove ? 'remove' : 'add', name, error: '' };
}

/**
 * Checks the package.json of a new project.
 *
 * @param {string} root - Repo root.
 * @param {string} name - Project name.
 * @returns {string} The reason to refuse, or an empty string.
 */
function packageProblem(root, name) {
  const folder = path.join(root, 'projects', name);
  if (inspectPath(folder)?.kind !== 'dir') {
    return `projects/${name} is not a folder (a link is not accepted)`;
  }
  const manifest = path.join(folder, 'package.json');
  if (inspectPath(manifest)?.kind !== 'file') {
    return `projects/${name}/package.json does not exist`;
  }
  const parsed = readJson(manifest);
  const actual = parsed !== null && typeof parsed === 'object' ? parsed['name'] : undefined;
  const expected = projectEntry(name).packageName;
  return actual === expected
    ? ''
    : `projects/${name}/package.json has the name ${JSON.stringify(actual ?? null)}, not "${expected}"`;
}

/**
 * Changes rush.json.
 *
 * @param {string} root - Repo root.
 * @param {'add' | 'remove'} mode - What to do.
 * @param {string} name - Project name.
 * @returns {string} The line to print. It throws with the reason to refuse.
 */
function changeRushJson(root, mode, name) {
  const file = path.join(root, 'rush.json');
  const text = readText(file);
  if (text === null) {
    throw new Error(`${file} cannot be read`);
  }
  const problem = mode === 'add' ? packageProblem(root, name) : '';
  if (problem !== '') {
    throw new Error(problem);
  }
  const result = mode === 'add' ? addProject(text, name) : removeProject(text, name);
  writeText(file, result.text);
  const entry = projectEntry(name);
  return mode === 'add'
    ? `added ${entry.packageName} (${entry.projectFolder}) to rush.json at projects[${String(result.index)}]`
    : `removed ${entry.packageName} (${entry.projectFolder}) from rush.json`;
}

/**
 * Runs the command.
 *
 * @param {string[]} argv - Arguments after the script name.
 * @returns {number} Exit code.
 */
export function main(argv) {
  const request = parseArguments(argv);
  if (request.error !== '') {
    process.stderr.write(`register-project: ${request.error}\n\n${HELP}`);
    return 2;
  }
  if (request.mode === 'help') {
    process.stdout.write(HELP);
    return 0;
  }
  try {
    const done = changeRushJson(repositoryRoot(process.cwd()), request.mode, request.name);
    process.stdout.write(`register-project: ${done}.\nNext step: ${NEXT_STEP}\n`);
    return 0;
  } catch (caught) {
    const reason = caught instanceof Error ? caught.message : String(caught);
    process.stderr.write(`register-project: refused: ${reason}. rush.json did not change.\n`);
    return 1;
  }
}

if (import.meta.filename === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}
