import path from 'node:path';

import { exists, listDirectory, readJson, readText } from './fs-io.mjs';
import { brunoHasAssertion } from './source-text.mjs';

const API_PARTS = ['api', 'api-py', 'api-go'];
const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'patch', 'head', 'options']);
const REQUEST_BLOCK = /^(get|put|post|delete|patch|head|options)\s*\{/;
const URL_LINE = /^\s*url\s*:\s*(.+?)\s*$/;
const NON_REQUEST_FILES = new Set(['collection.bru', 'folder.bru']);

/**
 * @typedef {object} Route
 * @property {string} method - Lowercase HTTP method.
 * @property {string} path - Normalized path: parameters are `{}`.
 * @property {string} source - File and line that define it, for messages.
 */

/**
 * @typedef {object} BrunoRequest
 * @property {string} file - Repo-relative path of the .bru file.
 * @property {string} method - Lowercase HTTP method.
 * @property {string} path - Normalized path.
 * @property {boolean} asserted - True when the file has an enabled assert line or an expect() in its tests block.
 */

/**
 * Turns a URL or an OpenAPI path into a comparable path: no origin, no query, parameters as `{}`.
 *
 * @param {string} value - A path such as `/v1/notes/{id}`, or a URL such as `{{baseUrl}}/v1/notes/:id?x=1`.
 * @returns {string} The normalized path.
 */
export function normalizePath(value) {
  const withoutQuery = value.split(/[?#]/)[0] ?? '';
  const withoutOrigin = withoutQuery.replace(/^\{\{[^}]*\}\}/, '').replace(/^https?:\/\/[^/]*/, '');
  const segments = withoutOrigin
    .split('/')
    .filter((segment) => segment !== '')
    .map((segment) => (/^(?::[\w-]+|\{[^}]*\}|\{\{[^}]*\}\})$/.test(segment) ? '{}' : segment));
  return `/${segments.join('/')}`;
}

/**
 * Reads the routes of a project from its OpenAPI document.
 *
 * @param {string} contractsFolder - Absolute contracts folder.
 * @param {string} relativeFolder - The same folder from the repo root.
 * @returns {{ routes: Route[], error: string }} Routes, or an error message for the report.
 */
export function readRoutes(contractsFolder, relativeFolder) {
  const openapi = path.join(contractsFolder, 'dist', 'openapi.json');
  const manifest = path.join(contractsFolder, 'routes.json');
  const file = exists(openapi) ? openapi : manifest;
  const shown = `${relativeFolder}/${path.relative(contractsFolder, file)}`;
  const document = readJson(file);
  if (document === null || typeof document !== 'object') {
    return {
      routes: [],
      error: `${relativeFolder}:1: no dist/openapi.json (or routes.json) found. Build the contracts first: node common/scripts/install-run-rush.js build --to <contracts package>.`,
    };
  }
  const paths =
    document['paths'] !== null && typeof document['paths'] === 'object' ? document['paths'] : {};
  const routes = Object.entries(paths).flatMap(([route, operations]) =>
    Object.keys(operations ?? {})
      .filter((method) => HTTP_METHODS.has(method.toLowerCase()))
      .map((method) => ({
        method: method.toLowerCase(),
        path: normalizePath(route),
        source: `${shown}:1`,
      })),
  );
  return { routes, error: '' };
}

/**
 * Reads the folders that `bruno.json` tells the runner to skip (`ignore`), except the usual ones.
 *
 * @param {string} brunoFolder - Absolute folder of the collection.
 * @returns {string[]} Folder or file names under the collection that the runner skips.
 */
function ignoredByCollection(brunoFolder) {
  const config = readJson(path.join(brunoFolder, 'bruno.json'));
  const list = config !== null && typeof config === 'object' ? config['ignore'] : undefined;
  return Array.isArray(list)
    ? list.filter((name) => typeof name === 'string' && !['node_modules', '.git'].includes(name))
    : [];
}

/**
 * Lists the .bru request files of a collection (not environments).
 *
 * @param {string} folder - Absolute folder.
 * @returns {string[]} Absolute file paths.
 */
function listBrunoFiles(folder) {
  return listDirectory(folder).flatMap((entry) => {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory) {
      return entry.name === 'environments' || entry.name === 'node_modules'
        ? []
        : listBrunoFiles(full);
    }
    return entry.name.endsWith('.bru') && !NON_REQUEST_FILES.has(entry.name) ? [full] : [];
  });
}

/**
 * Reads one .bru file.
 *
 * @param {string} root - Repo root.
 * @param {string} file - Absolute path of the .bru file.
 * @returns {BrunoRequest | null} The request, or null when the file has no request block.
 */
function readRequest(root, file) {
  const text = readText(file) ?? '';
  const lines = text.split('\n');
  const start = lines.findIndex((line) => REQUEST_BLOCK.test(line));
  if (start === -1) {
    return null;
  }
  const method = REQUEST_BLOCK.exec(lines[start] ?? '')?.[1] ?? '';
  const urlText =
    lines
      .slice(start + 1)
      .map((line) => URL_LINE.exec(line)?.[1])
      .find((match) => match !== undefined) ?? '';
  return {
    file: path.relative(root, file).split(path.sep).join('/'),
    method,
    path: normalizePath(urlText),
    asserted: brunoHasAssertion(text),
  };
}

/**
 * Tells whether a request path matches a route path (equal, or the request has a base path prefix).
 *
 * @param {string} requestPath - Normalized path of the .bru request.
 * @param {string} routePath - Normalized path of the route.
 * @returns {boolean} True when they match.
 */
function pathsMatch(requestPath, routePath) {
  return requestPath === routePath || requestPath.endsWith(routePath);
}

/**
 * Checks the Bruno collection of one project against its routes.
 *
 * @param {string} root - Repo root.
 * @param {string} project - Project name (folder under projects/).
 * @returns {string[]} Messages in the form `file:line: text`. Empty when the project passes.
 */
export function checkBrunoProject(root, project) {
  const base = path.join(root, 'projects', project);
  const { routes, error } = readRoutes(
    path.join(base, 'contracts'),
    `projects/${project}/contracts`,
  );
  if (error !== '') {
    return [error];
  }
  const brunoFolder = path.join(base, 'bruno');
  const ignored = ignoredByCollection(brunoFolder);
  const messages = ignored.map(
    (name) =>
      `projects/${project}/bruno/bruno.json:1: the collection ignores "${name}", so the runner skips those requests. Remove it from "ignore".`,
  );
  const requests = listBrunoFiles(brunoFolder)
    .filter((file) => {
      const [top] = path.relative(brunoFolder, file).split(path.sep);
      return !ignored.includes(top ?? '');
    })
    .map((file) => readRequest(root, file))
    .filter((request) => request !== null);
  if (routes.length === 0) {
    messages.push(
      `projects/${project}/contracts:1: the contracts declare no routes, but the project has an API part. Add the routes to the contracts, or remove the API part.`,
    );
  }
  for (const route of routes) {
    const matching = requests.filter(
      (request) => request.method === route.method && pathsMatch(request.path, route.path),
    );
    if (matching.length === 0) {
      messages.push(
        `${route.source}: no .bru file in projects/${project}/bruno for ${route.method.toUpperCase()} ${route.path}. Add one with a docs block and an assert entry (api-docs skill).`,
      );
    } else if (!matching.some((request) => request.asserted)) {
      const first = matching[0];
      messages.push(
        `${first?.file ?? ''}:1: the request for ${route.method.toUpperCase()} ${route.path} has no assert entry or test. Add an assertion.`,
      );
    }
  }
  for (const request of requests.filter((item) => !item.asserted)) {
    messages.push(
      `${request.file}:1: the request has no enabled assert line and no expect() in its tests block. Add a real assertion.`,
    );
  }
  return [...new Set(messages)];
}

/**
 * Lists the projects that have an API part.
 *
 * @param {string} root - Repo root.
 * @returns {string[]} Project folder names under projects/.
 */
export function projectsWithApi(root) {
  return listDirectory(path.join(root, 'projects'))
    .filter((entry) => entry.isDirectory)
    .map((entry) => entry.name)
    .filter((name) =>
      API_PARTS.some(
        (part) =>
          exists(path.join(root, 'projects', name, part, 'package.json')) ||
          exists(path.join(root, 'projects', name, part, 'pyproject.toml')) ||
          exists(path.join(root, 'projects', name, part, 'go.mod')),
      ),
    );
}
