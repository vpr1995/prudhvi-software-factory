// Engine for `rush add-part`. It adds one part (a folder) to a project that `rush new --project`
// made: it copies the part template, merges the part's scripts and dependencies into the project
// package.json, makes the config edits of the part and adds the part's review section.
import { listFiles, pathExists, readText, replaceText, writeNewText } from './fs-io.js';
import { fillName, fillVersions, nameProblem, parseProjects, TEMPLATE_SUFFIX } from './scaffold.js';

// The same versions source as the "project" kind of `rush new` (scaffold.js).
const VERSIONS_FROM = 'projects/sample/package.json';
const RUSH_JSON = 'rush.json';
// The part template holds this fragment. The engine merges it into the project package.json.
const MANIFEST_FRAGMENT = 'package.json';
const MANIFEST_FIELDS = ['scripts', 'dependencies', 'devDependencies'];
// scripts/phase.mjs of a project that `rush new --project` made has this text.
const PHASE_SCRIPT = 'scripts/phase.mjs';
const PHASE_SCRIPT_MARK = 'rush add-part';
const PORT_PLACEHOLDER = '__port__';
// The web part gets the next port after the highest port of a Playwright config in projects/.
const PORT_PATTERN = /_PORT = (\d+);/g;
const FIRST_PORT = 4330;
const JSON_INDENT = 2;

/**
 * @typedef {object} Edit
 * @property {string} file - File in the project.
 * @property {string} from - Exact text that must be in the file.
 * @property {string} to - Replacement text.
 */

/**
 * @typedef {object} Part
 * @property {string} marker - Path in the project that shows the part exists.
 * @property {string} review - Review template that goes into the project REVIEW.md.
 * @property {Edit[]} edits - Config edits.
 * @property {string[]} nextSteps - Steps for the user after the part is added.
 */

/**
 * The parts that `rush add-part` can add. Each part has a template folder parts/<part>.
 * scripts/phase.mjs in the project finds each part by the same marker.
 *
 * @type {Readonly<Record<string, Part>>}
 */
export const PARTS = {
  node: {
    marker: 'src/api',
    review: 'docs/templates/REVIEW.api.md',
    edits: [],
    nextSteps: [
      'Add each route with the new-api-route skill. Put its Zod schema in src/contracts/.',
      'Add a Bruno request with docs and assertions for each route in bruno/.',
    ],
  },
  web: {
    marker: 'web',
    review: 'docs/templates/REVIEW.web.md',
    edits: [
      {
        file: 'vitest.config.ts',
        from: 'createAppVitestConfig()',
        to: 'createAppVitestConfig({ web: true })',
      },
    ],
    nextSteps: [
      'Add each page with the new-web-page skill. Each page gets a Playwright spec with an axe check.',
    ],
  },
  infra: {
    marker: 'cdk.json',
    review: 'docs/templates/REVIEW.infra.md',
    edits: [],
    nextSteps: [
      'Add each construct with the new-cdk-construct skill. Never run cdk deploy.',
      'Check the CDK app: (cd projects/<name> && npx cdk synth --quiet).',
    ],
  },
};

/**
 * Merge the fields of a filled fragment into a manifest. Fail when a script has another value.
 *
 * @param {Record<string, Record<string, string>>} manifest - Parsed project package.json. It changes.
 * @param {Record<string, Record<string, string>>} fragment - Parsed, filled fragment.
 * @param {string} file - Path of the project package.json, for messages.
 * @returns {void}
 */
export function mergeManifest(manifest, fragment, file) {
  for (const field of MANIFEST_FIELDS) {
    const added = fragment[field];
    if (added === undefined) continue;
    const current = manifest[field] ?? {};
    for (const [key, value] of Object.entries(added)) {
      if (field === 'scripts' && current[key] !== undefined && current[key] !== value) {
        throw new Error(`${file} already has the script "${key}" with another value`);
      }
      current[key] = value;
    }
    manifest[field] = Object.fromEntries(
      Object.entries(current).sort(([a], [b]) => a.localeCompare(b)),
    );
  }
}

/**
 * Find the next free Playwright port. It reads the Playwright config of each project in rush.json.
 *
 * @param {string} root - Repo root.
 * @param {{ projectFolder: string }[]} projects - The rush.json entries.
 * @returns {Promise<number>} The next port.
 */
async function nextPort(root, projects) {
  let highest = FIRST_PORT - 1;
  for (const { projectFolder } of projects) {
    const file = `${projectFolder}/playwright.config.ts`;
    if (!(await pathExists(root, file))) continue;
    for (const match of (await readText(root, file)).matchAll(PORT_PATTERN)) {
      highest = Math.max(highest, Number(match[1]));
    }
  }
  return highest + 1;
}

/**
 * Find a project that `rush new --project` made. Fail when it is not in rush.json or has no
 * part-aware phase script.
 *
 * @param {string} root - Repo root.
 * @param {string} project - Project name in kebab-case.
 * @returns {Promise<{ folder: string, packageName: string, projects: { projectFolder: string }[] }>} The project and every rush.json entry.
 */
async function findProject(root, project) {
  const folder = `projects/${project}`;
  const packageName = `@vprprudhvi/${project}`;
  const projects = parseProjects(await readText(root, RUSH_JSON));
  if (!projects.some((item) => item.packageName === packageName && item.projectFolder === folder)) {
    throw new Error(
      `rush.json has no ${packageName} in ${folder}. Run rush new --project ${project} first`,
    );
  }
  const phaseScript = `${folder}/${PHASE_SCRIPT}`;
  if (
    !(await pathExists(root, phaseScript)) ||
    !(await readText(root, phaseScript)).includes(PHASE_SCRIPT_MARK)
  ) {
    throw new Error(
      `${folder} was not made by rush new --project (${phaseScript} does not find parts). Add the part by hand`,
    );
  }
  return { folder, packageName, projects };
}

/**
 * Fill the part templates. Fail when a target file exists.
 *
 * @param {object} options - Options.
 * @param {string} options.root - Repo root.
 * @param {string} options.templateRoot - Absolute path of the part template folder.
 * @param {string} options.folder - Project folder, relative to the root.
 * @param {(text: string) => string} options.fill - Fills the placeholders.
 * @returns {Promise<{ outputs: { target: string, text: string }[], fragment: string }>} The new files and the package.json fragment text.
 */
async function renderPart({ root, templateRoot, folder, fill }) {
  const templates = (await listFiles(templateRoot)).filter((file) =>
    file.endsWith(TEMPLATE_SUFFIX),
  );
  const outputs = [];
  let fragment = '{}';
  for (const file of templates) {
    const relative = fill(file.slice(0, -TEMPLATE_SUFFIX.length));
    const text = fill(await readText(templateRoot, file));
    if (relative === MANIFEST_FRAGMENT) {
      fragment = text;
      continue;
    }
    const target = `${folder}/${relative}`;
    if (await pathExists(root, target)) throw new Error(`${target} already exists`);
    outputs.push({ target, text });
  }
  return { outputs, fragment };
}

/**
 * Make the config edits of a part in memory. Fail when a file does not have the expected text.
 *
 * @param {string} root - Repo root.
 * @param {string} folder - Project folder, relative to the root.
 * @param {string} part - Key of PARTS.
 * @returns {Promise<{ file: string, text: string }[]>} The new file texts.
 */
async function planEdits(root, folder, part) {
  const planned = [];
  for (const edit of PARTS[part]?.edits ?? []) {
    const file = `${folder}/${edit.file}`;
    const text = await readText(root, file);
    if (!text.includes(edit.from)) {
      throw new Error(`${file} does not have "${edit.from}". Make the ${part} edit by hand`);
    }
    planned.push({ file, text: text.replace(edit.from, edit.to) });
  }
  return planned;
}

/**
 * Add one part to a project. It checks everything first and writes nothing on error.
 *
 * @param {object} options - Options.
 * @param {string} options.root - Repo root. Tests pass a temp folder.
 * @param {string} options.templatesFolder - Absolute path of tooling/templates.
 * @param {string} options.project - Project name in kebab-case.
 * @param {string} options.part - Key of PARTS.
 * @returns {Promise<{ folder: string, packageName: string, files: string[], nextSteps: string[] }>} What was written. Paths are relative to the root.
 */
export async function addPart({ root, templatesFolder, project, part }) {
  const settings = Object.hasOwn(PARTS, part) ? PARTS[part] : undefined;
  if (settings === undefined) {
    throw new Error(`unknown part "${part}". Use one of: ${Object.keys(PARTS).join(', ')}`);
  }
  const problem = nameProblem(project);
  if (problem !== '') throw new Error(problem);
  const { folder, packageName, projects } = await findProject(root, project);
  if (await pathExists(root, `${folder}/${settings.marker}`)) {
    throw new Error(`${folder} already has the ${part} part (${folder}/${settings.marker} exists)`);
  }

  const port = part === 'web' ? String(await nextPort(root, projects)) : '';
  const { outputs, fragment } = await renderPart({
    root,
    templateRoot: `${templatesFolder}/parts/${part}`,
    folder,
    fill: (text) => fillName(text, project).replaceAll(PORT_PLACEHOLDER, port),
  });
  const reference = JSON.parse(await readText(root, VERSIONS_FROM));
  const manifestFile = `${folder}/package.json`;
  const manifest = JSON.parse(await readText(root, manifestFile));
  mergeManifest(
    manifest,
    JSON.parse(fillVersions(fragment, reference, VERSIONS_FROM)),
    manifestFile,
  );
  const edits = await planEdits(root, folder, part);
  const reviewFile = `${folder}/REVIEW.md`;
  const review = (await readText(root, reviewFile)).trimEnd();
  // The template has a level 1 heading. In the project file it is a section.
  const section = (await readText(root, settings.review)).replace(/^# /, '## ');

  for (const output of outputs) await writeNewText(root, output.target, output.text);
  await replaceText(root, manifestFile, `${JSON.stringify(manifest, undefined, JSON_INDENT)}\n`);
  for (const edit of edits) await replaceText(root, edit.file, edit.text);
  await replaceText(root, reviewFile, `${review}\n\n${section}`);

  return {
    folder,
    packageName,
    files: [
      ...outputs.map((output) => output.target),
      manifestFile,
      ...edits.map((edit) => edit.file),
      reviewFile,
    ],
    nextSteps: settings.nextSteps.map((step) => step.replaceAll('<name>', project)),
  };
}
