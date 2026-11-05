// Scaffolder engine for `rush new`. It copies a template folder, fills the placeholders,
// adds the project to rush.json and writes a Rush change file when the kind needs one.
// Template files end in ".tmpl", so no lint, typecheck, tsconfig check or Prettier run reads them.
import { listFiles, pathExists, readText, replaceText, writeNewText } from './fs-io.js';

export const NAME_PLACEHOLDER = '__name__';
// The same name in PascalCase (class names) and in UPPER_SNAKE_CASE (environment variables).
export const PASCAL_NAME_PLACEHOLDER = '__Name__';
export const CONSTANT_NAME_PLACEHOLDER = '__NAME__';
export const VERSION_PLACEHOLDER = '__version__';
export const TEMPLATE_SUFFIX = '.tmpl';
const RUSH_JSON = 'rush.json';
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies'];
const JSON_INDENT = 2;
const DATE_PARTS_END = 16;

/**
 * @typedef {object} Kind
 * @property {string} template - Template folder, relative to the templates folder.
 * @property {string} folder - Target folder, relative to the repo root.
 * @property {string} packageName - npm name of the new project.
 * @property {boolean} shouldPublish - Value for rush.json.
 * @property {string[]} tags - Rush tags.
 * @property {string} versionsFrom - package.json that gives each "__version__" its value.
 * @property {boolean} changeFile - True when the new project needs a Rush change file.
 */

/**
 * The kinds that `rush new` can make. Each value can hold "__name__".
 * To add a kind, add a template folder and an entry here.
 *
 * @type {Readonly<Record<string, Kind>>}
 */
export const KINDS = {
  library: {
    template: 'library',
    folder: 'packages/__name__',
    packageName: '@vprprudhvi/shared-__name__',
    shouldPublish: true,
    tags: ['shared'],
    // The template copies this package. With ensureConsistentVersions, each version is the repo version.
    versionsFrom: 'packages/result/package.json',
    changeFile: true,
  },
  project: {
    template: 'project',
    folder: 'projects/__name__',
    packageName: '@vprprudhvi/__name__',
    shouldPublish: false,
    tags: ['project/__name__'],
    // The sample has every part, so it has a version for each dependency of each part.
    versionsFrom: 'projects/sample/package.json',
    // A project does not publish, so Rush needs no change file.
    changeFile: false,
  },
};

/**
 * Return the reason why a name is not valid. Return an empty string when the name is valid.
 *
 * @param {string} name - Name from the command line.
 * @returns {string} The reason, or "".
 */
export function nameProblem(name) {
  if (!/^[a-z][\da-z-]*$/.test(name) || name.endsWith('-') || name.includes('--')) {
    return `name "${name}" is not kebab-case. Use lowercase letters, digits and single hyphens, for example "date-utils"`;
  }
  return '';
}

/**
 * @param {string} text - Template text.
 * @param {string} name - Project name in kebab-case.
 * @returns {string} The text with each "__name__", "__Name__" and "__NAME__" replaced.
 */
export function fillName(text, name) {
  const words = name.split('-');
  const pascal = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join('');
  return text
    .replaceAll(NAME_PLACEHOLDER, name)
    .replaceAll(PASCAL_NAME_PLACEHOLDER, pascal)
    .replaceAll(CONSTANT_NAME_PLACEHOLDER, words.join('_').toUpperCase());
}

/**
 * Parse the "projects" array of rush.json. It must be the last key and must have no comments.
 *
 * @param {string} text - rush.json text.
 * @returns {{ packageName: string, projectFolder: string }[]} The project entries.
 */
export function parseProjects(text) {
  const start = text.indexOf('"projects"');
  try {
    if (start === -1) throw new Error('no "projects" key');
    return JSON.parse(`{${text.slice(start)}`).projects;
  } catch (error) {
    throw new Error(
      `rush.json: cannot read the "projects" array (${error instanceof Error ? error.message : String(error)}). It must be the last key and have no comments`,
      { cause: error },
    );
  }
}

/**
 * Add one project entry after the last entry of the "projects" array. The rest of the text stays.
 *
 * @param {string} text - rush.json text.
 * @param {{ packageName: string, projectFolder: string, shouldPublish: boolean, tags: string[] }} entry - The new entry.
 * @returns {string} The new rush.json text.
 */
export function insertProject(text, entry) {
  const end = /\}(\s*\]\s*\}\s*)$/.exec(text);
  if (end === null) {
    throw new Error(
      'rush.json: the file must end with the "projects" array. Add the entry by hand',
    );
  }
  const block = [
    ',',
    '    {',
    `      "packageName": ${JSON.stringify(entry.packageName)},`,
    `      "projectFolder": ${JSON.stringify(entry.projectFolder)},`,
    `      "shouldPublish": ${String(entry.shouldPublish)},`,
    `      "tags": [${entry.tags.map((tag) => JSON.stringify(tag)).join(', ')}]`,
    '    }',
  ].join('\n');
  return `${text.slice(0, end.index + 1)}${block}${end[1]}`;
}

/**
 * Replace each "__version__" in the package.json text with the version in the reference package.
 *
 * @param {string} text - package.json text, with names filled.
 * @param {Record<string, unknown>} reference - Parsed reference package.json.
 * @param {string} referenceFile - Path of the reference, for messages.
 * @returns {string} The package.json text.
 */
export function fillVersions(text, reference, referenceFile) {
  const manifest = JSON.parse(text);
  /** @type {Record<string, string>} */
  const known = Object.assign({}, ...DEPENDENCY_FIELDS.map((field) => reference[field] ?? {}));
  for (const field of DEPENDENCY_FIELDS) {
    /** @type {Record<string, string>} */
    const dependencies = manifest[field] ?? {};
    for (const [dependency, version] of Object.entries(dependencies)) {
      if (version !== VERSION_PLACEHOLDER) continue;
      const value = known[dependency];
      if (value === undefined) {
        throw new Error(
          `${referenceFile} has no version for "${dependency}". Add it there or set it in the template`,
        );
      }
      dependencies[dependency] = value;
    }
  }
  return `${JSON.stringify(manifest, undefined, JSON_INDENT)}\n`;
}

/**
 * @param {Date} now - Time of the change.
 * @returns {string} The time as "YYYY-MM-DD-HH-mm" (UTC), as Rush names change files.
 */
export function changeFileStamp(now) {
  return now.toISOString().slice(0, DATE_PARTS_END).replaceAll(/[:T]/g, '-');
}

/**
 * Make a new project from a template. It checks everything first and writes nothing on error.
 *
 * @param {object} options - Options.
 * @param {string} options.root - Repo root. Tests pass a temp folder.
 * @param {string} options.templatesFolder - Absolute path of tooling/templates.
 * @param {string} options.kind - Key of KINDS, for example "library".
 * @param {string} options.name - Project name in kebab-case.
 * @param {Date | undefined} [options.now] - Time for the change file name.
 * @returns {Promise<{ folder: string, packageName: string, files: string[] }>} What was written. Paths are relative to the root.
 */
export async function scaffold({ root, templatesFolder, kind, name, now = new Date() }) {
  const settings = Object.hasOwn(KINDS, kind) ? KINDS[kind] : undefined;
  if (settings === undefined) throw new Error(`unknown kind "${kind}"`);
  const problem = nameProblem(name);
  if (problem !== '') throw new Error(problem);

  const folder = fillName(settings.folder, name);
  const packageName = fillName(settings.packageName, name);
  const rushJson = await readText(root, RUSH_JSON);
  const taken = parseProjects(rushJson).find(
    (project) => project.packageName === packageName || project.projectFolder === folder,
  );
  if (taken !== undefined) {
    throw new Error(`rush.json already has ${taken.packageName} (${taken.projectFolder})`);
  }
  if (await pathExists(root, folder)) throw new Error(`folder ${folder} already exists`);

  const reference = JSON.parse(await readText(root, settings.versionsFrom));
  const templateRoot = `${templatesFolder}/${settings.template}`;
  const outputs = await Promise.all(
    (await listFiles(templateRoot))
      .filter((file) => file.endsWith(TEMPLATE_SUFFIX))
      .map(async (file) => {
        const target = `${folder}/${fillName(file.slice(0, -TEMPLATE_SUFFIX.length), name)}`;
        const text = fillName(await readText(templateRoot, file), name);
        const filled = target.endsWith('/package.json')
          ? fillVersions(text, reference, settings.versionsFrom)
          : text;
        return { target, text: filled };
      }),
  );

  for (const output of outputs) await writeNewText(root, output.target, output.text);
  const files = outputs.map((output) => output.target);
  await replaceText(
    root,
    RUSH_JSON,
    insertProject(rushJson, {
      packageName,
      projectFolder: folder,
      shouldPublish: settings.shouldPublish,
      tags: settings.tags.map((tag) => fillName(tag, name)),
    }),
  );
  files.push(RUSH_JSON);

  if (settings.changeFile) {
    const changeFile = `common/changes/${packageName}/new-${kind}_${changeFileStamp(now)}.json`;
    const change = {
      changes: [{ packageName, comment: `Add the ${packageName} package.`, type: 'minor' }],
      packageName,
    };
    await writeNewText(root, changeFile, `${JSON.stringify(change, undefined, JSON_INDENT)}\n`);
    files.push(changeFile);
  }
  return { folder, packageName, files };
}
