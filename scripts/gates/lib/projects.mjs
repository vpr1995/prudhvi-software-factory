import path from 'node:path';

import { exists, listDirectory, pathKind, readText } from './fs-io.mjs';

/** @typedef {{ name: string, folder: string }} RushProject */

const MANIFESTS = ['package.json', 'pyproject.toml', 'go.mod'];
const PROJECT_INFRA = /^(projects\/[^/]+)\/(?:(?:bin|lib)\/|cdk\.json$)/;
const PLATFORM_INFRA = /^(platform\/infra)(?:\/|$)/;
const FULL_VERIFY_PATHS = [/^rush\.json$/, /^common\/config\/rush\//, /^common\/autoinstallers\//];

/**
 * The parts of a project and the folders that mark each one (from the project folder).
 * A project is `projects/<name>/package.json`. The `infra` part is the CDK app: `bin` or `lib`.
 */
export const PROJECT_PARTS = Object.freeze({
  contracts: ['src/contracts'],
  api: ['src/api'],
  'api-py': ['src/api-py'],
  'api-go': ['src/api-go'],
  web: ['web'],
  infra: ['bin', 'lib'],
});

/**
 * Lists the projects: the folders under `projects/` that have a package.json.
 *
 * @param {string} root - Repo root.
 * @returns {string[]} Project folder names, sorted.
 */
export function listProjects(root) {
  return listDirectory(path.join(root, 'projects'))
    .filter((entry) => entry.isDirectory)
    .map((entry) => entry.name)
    .filter((name) => exists(path.join(root, 'projects', name, 'package.json')))
    .sort();
}

/**
 * Detects the parts of a project by folder.
 *
 * @param {string} root - Repo root.
 * @param {string} project - Project folder name under projects/.
 * @returns {string[]} Part names (keys of PROJECT_PARTS) that the project has. Empty when it is not a project.
 */
export function projectParts(root, project) {
  const base = path.join(root, 'projects', project);
  if (!exists(path.join(base, 'package.json'))) {
    return [];
  }
  return Object.entries(PROJECT_PARTS)
    .filter(([, folders]) => folders.some((folder) => pathKind(path.join(base, folder)) === 'dir'))
    .map(([part]) => part);
}

/**
 * Lists the projects that have at least one of the given parts.
 *
 * @param {string} root - Repo root.
 * @param {string[]} parts - Part names.
 * @returns {string[]} Project folder names.
 */
export function projectsWithParts(root, parts) {
  return listProjects(root).filter((name) =>
    projectParts(root, name).some((part) => parts.includes(part)),
  );
}

/**
 * Finds the end of a string literal.
 *
 * @param {string} text - Source text.
 * @param {number} start - Index of the opening quote.
 * @returns {number} Index just after the closing quote.
 */
function endOfString(text, start) {
  let index = start + 1;
  while (index < text.length && text[index] !== '"') {
    index += text[index] === '\\' ? 2 : 1;
  }
  return index + 1;
}

/**
 * Finds the end of a comment that starts at an index.
 *
 * @param {string} text - Source text.
 * @param {number} start - Index of the first slash.
 * @returns {number} Index just after the comment, or the start when there is no comment.
 */
function endOfComment(text, start) {
  if (text[start + 1] === '/') {
    const newline = text.indexOf('\n', start);
    return newline === -1 ? text.length : newline;
  }
  if (text[start + 1] === '*') {
    const close = text.indexOf('*/', start + 2);
    return close === -1 ? text.length : close + 2;
  }
  return start;
}

/**
 * Removes `//` and block comments and trailing commas from JSONC text. It keeps string
 * contents, so a URL such as "https://x" stays intact.
 *
 * @param {string} text - JSONC text.
 * @returns {string} JSON text.
 */
export function stripJsonComments(text) {
  let output = '';
  let index = 0;
  while (index < text.length) {
    const char = text[index] ?? '';
    const commentEnd = char === '/' ? endOfComment(text, index) : index;
    if (char === '"') {
      const end = endOfString(text, index);
      output += text.slice(index, end);
      index = end;
    } else if (commentEnd > index) {
      index = commentEnd;
    } else {
      output += char;
      index += 1;
    }
  }
  return output.replaceAll(/,(\s*[}\]])/g, '$1');
}

/**
 * Reads the Rush project list from rush.json.
 *
 * @param {string} root - Repo root.
 * @returns {RushProject[]} Projects. Empty when rush.json is missing or invalid.
 */
export function loadRushProjects(root) {
  const text = readText(path.join(root, 'rush.json'));
  if (text === null) {
    return [];
  }
  try {
    const parsed = JSON.parse(stripJsonComments(text));
    const list = Array.isArray(parsed.projects) ? parsed.projects : [];
    return list.map((entry) => ({
      name: String(entry.packageName),
      folder: String(entry.projectFolder),
    }));
  } catch {
    return [];
  }
}

/**
 * Finds the Rush project that owns a path (the longest matching project folder).
 *
 * @param {RushProject[]} projects - Rush projects.
 * @param {string} relativePath - Path from the repo root.
 * @returns {RushProject | null} The project, or null.
 */
export function ownerProject(projects, relativePath) {
  const owners = projects.filter(
    (project) => relativePath === project.folder || relativePath.startsWith(`${project.folder}/`),
  );
  return owners.sort((left, right) => right.folder.length - left.folder.length)[0] ?? null;
}

/**
 * Splits changed paths into impacted Rush projects, infra folders, and a flag for global changes.
 *
 * @param {string} root - Repo root.
 * @param {string[]} changedPaths - Changed paths from the repo root.
 * @returns {{ projects: string[], infraFolders: string[], full: boolean }} Impact.
 */
export function impactOf(root, changedPaths) {
  const projects = loadRushProjects(root);
  const names = new Set();
  const infra = new Set();
  let full = false;
  for (const changed of changedPaths) {
    const owner = ownerProject(projects, changed);
    if (owner !== null) {
      names.add(owner.name);
    }
    const infraMatch = PROJECT_INFRA.exec(changed) ?? PLATFORM_INFRA.exec(changed);
    if (infraMatch !== null) {
      infra.add(infraMatch[1] ?? '');
    }
    full = full || FULL_VERIFY_PATHS.some((pattern) => pattern.test(changed));
  }
  return { projects: [...names].sort(), infraFolders: [...infra].sort(), full };
}

/**
 * Walks up from a file to the nearest project manifest (package.json, pyproject.toml, go.mod).
 *
 * @param {string} root - Repo root.
 * @param {string} absoluteFile - Absolute file path.
 * @returns {{ directory: string, marker: string } | null} The project folder and which manifest it has.
 */
export function findManifestDirectory(root, absoluteFile) {
  let directory = path.dirname(absoluteFile);
  while (directory.startsWith(root)) {
    const marker = MANIFESTS.find((name) => exists(path.join(directory, name)));
    if (marker !== undefined) {
      return { directory, marker };
    }
    if (directory === root) {
      break;
    }
    directory = path.dirname(directory);
  }
  return null;
}
