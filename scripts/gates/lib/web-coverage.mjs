import path from 'node:path';

import { exists, listDirectory, readText } from './fs-io.mjs';
import { projectsWithParts } from './projects.mjs';
import { stripComments } from './source-text.mjs';

const PAGE_FILE = /^page\.(?:tsx|jsx|ts|js)$/;
const SPEC_FILE = /\.spec\.(?:tsx|jsx|ts|js|mjs)$/;
const APP_FOLDERS = ['app', 'src/app'];
const GOTO_CALL = /\.goto\(\s*(["'`])([^"'`]*)\1/g;
// A test call: test or it, with up to three dotted members. The call name is group 1.
const TEST_START = /(?:^|[\s;{}])((?:test|it)(?:\.\w+|)(?:\.\w+|)(?:\.\w+|))\s*\(/g;
const NOT_A_TEST_MEMBERS = new Set([
  'describe',
  'beforeEach',
  'afterEach',
  'beforeAll',
  'afterAll',
  'use',
  'step',
  'setTimeout',
  'extend',
  'configure',
]);
const HELPER_FUNCTION = /(?:^|\n)\s*(?:export\s+|)(?:async\s+|)function\s+(\w+)/g;
const HELPER_ARROW =
  /(?:^|\n)\s*(?:export\s+|)const\s+(\w+)\s*=\s*(?:async\s*|)(?:\([^)]*\)|\w+)\s*=>/g;
// An axe check that asserts by itself, or an AxeBuilder run whose result is checked with expect().
const SELF_CHECKING_AXE = /\b(?:checkA11y|expectNoA11yViolations)\s*\(/;
const AXE_ANALYZE = /\bnew\s+AxeBuilder\s*\([\s\S]*?\.analyze\s*\(/;
const EXPECT_CALL = /\bexpect\s*\(/;

/**
 * @typedef {object} PageRoute
 * @property {string} file - Repo-relative path of the page file.
 * @property {string[]} segments - Route segments. `[id]` is kept as is.
 */

/**
 * @typedef {object} Spec
 * @property {string} file - Repo-relative path.
 * @property {SpecTest[]} tests - The tests of the file.
 */

/**
 * @typedef {object} SpecTest
 * @property {string[][]} targets - Segments of each `page.goto` target in this test (and its helpers).
 * @property {boolean} hasAxe - True when this test runs an axe check and checks the result.
 */

/**
 * Lists the files under a folder, depth first.
 *
 * @param {string} folder - Absolute folder.
 * @returns {{ file: string, parts: string[] }[]} Files with the folder names between the start and the file.
 */
function walk(folder) {
  const output = [];
  const pending = [{ directory: folder, parts: /** @type {string[]} */ ([]) }];
  for (let current = pending.pop(); current !== undefined; current = pending.pop()) {
    for (const entry of listDirectory(current.directory)) {
      if (entry.name === 'node_modules') {
        continue;
      }
      const full = path.join(current.directory, entry.name);
      if (entry.isDirectory) {
        pending.push({ directory: full, parts: [...current.parts, entry.name] });
      } else {
        output.push({ file: full, parts: current.parts });
      }
    }
  }
  return output;
}

/**
 * Turns the folders of a page file into route segments.
 *
 * @param {string[]} parts - Folder names under `app`.
 * @returns {string[] | null} The segments, or null when the folder does not make a public route.
 */
function routeSegments(parts) {
  const segments = [];
  for (const part of parts) {
    if (part.startsWith('_') || part.startsWith('@') || part.startsWith('(.')) {
      return null;
    }
    if (!(part.startsWith('(') && part.endsWith(')'))) {
      segments.push(part);
    }
  }
  return segments;
}

/**
 * Finds the page routes of a web app.
 *
 * @param {string} root - Repo root.
 * @param {string} webFolder - Absolute web folder.
 * @returns {PageRoute[]} Routes.
 */
export function findPageRoutes(root, webFolder) {
  const routes = [];
  for (const appFolder of APP_FOLDERS) {
    const base = path.join(webFolder, appFolder);
    for (const entry of walk(base)) {
      const segments = PAGE_FILE.test(path.basename(entry.file))
        ? routeSegments(entry.parts)
        : null;
      if (segments !== null) {
        routes.push({ file: path.relative(root, entry.file).split(path.sep).join('/'), segments });
      }
    }
  }
  return routes;
}

/**
 * Splits a goto target into path segments (no origin, query or hash).
 *
 * @param {string} target - The string given to `page.goto`.
 * @returns {string[]} Segments. A `${...}` part stays in the segment.
 */
function targetSegments(target) {
  const withoutOrigin = target.replace(/^https?:\/\/[^/]*/, '').replace(/^\$\{[^}]*\}(?=\/)/, '');
  const pathOnly = withoutOrigin.split(/[?#]/)[0] ?? '';
  return pathOnly.split('/').filter((segment) => segment !== '');
}

/**
 * Tells whether a text calls a function by name (`name(` with a word boundary before the name).
 *
 * @param {string} text - Source text.
 * @param {string} name - Function name.
 * @returns {boolean} True when the text has a call.
 */
function callsFunction(text, name) {
  for (let index = text.indexOf(name); index !== -1; index = text.indexOf(name, index + 1)) {
    const startsWord = !/\w/.test(text[index - 1] ?? '');
    if (startsWord && /^\s*\(/.test(text.slice(index + name.length))) {
      return true;
    }
  }
  return false;
}

/**
 * Cuts the text of a spec into units: each test call and each local helper function.
 *
 * @param {string} text - Spec text without comments.
 * @returns {{ kind: 'test' | 'helper', name: string, text: string }[]} Units in file order.
 */
function splitUnits(text) {
  const starts = [
    ...[...text.matchAll(TEST_START)]
      .filter((match) => !(match[1] ?? '').split('.').some((part) => NOT_A_TEST_MEMBERS.has(part)))
      .map((match) => ({
        kind: /** @type {const} */ ('test'),
        name: '',
        index: match.index + match[0].length - 1,
      })),
    ...[...text.matchAll(HELPER_FUNCTION), ...text.matchAll(HELPER_ARROW)].map((match) => ({
      kind: /** @type {const} */ ('helper'),
      name: match[1] ?? '',
      index: match.index,
    })),
  ].sort((left, right) => left.index - right.index);
  return starts.map((start, position) => ({
    kind: start.kind,
    name: start.name,
    text: text.slice(start.index, starts[position + 1]?.index ?? text.length),
  }));
}

/**
 * Tells whether a unit text runs an axe check and checks its result.
 *
 * @param {string} text - Unit text.
 * @returns {boolean} True when it checks.
 */
function checksAxe(text) {
  return SELF_CHECKING_AXE.test(text) || (AXE_ANALYZE.test(text) && EXPECT_CALL.test(text));
}

/**
 * Reads the Playwright specs of a web app. Comments do not count. A test counts for a route only
 * when its own text (or a helper function of the same file that it calls) holds the goto, and the
 * axe check must be in the same test.
 *
 * @param {string} root - Repo root.
 * @param {string} webFolder - Absolute web folder.
 * @returns {Spec[]} Specs.
 */
export function readSpecs(root, webFolder) {
  return walk(path.join(webFolder, 'e2e'))
    .filter((entry) => SPEC_FILE.test(entry.file))
    .map((entry) => {
      const text = stripComments(readText(entry.file) ?? '');
      const units = splitUnits(text);
      const helpers = new Map(
        units.filter((unit) => unit.kind === 'helper').map((unit) => [unit.name, unit.text]),
      );
      const tests = units
        .filter((unit) => unit.kind === 'test')
        .map((unit) => {
          const reached = [unit.text];
          for (const [name, helperText] of helpers) {
            if (callsFunction(unit.text, name)) {
              reached.push(helperText);
            }
          }
          const joined = reached.join('\n');
          return {
            targets: [...joined.matchAll(GOTO_CALL)].map((match) => targetSegments(match[2] ?? '')),
            hasAxe: checksAxe(joined),
          };
        });
      return { file: path.relative(root, entry.file).split(path.sep).join('/'), tests };
    });
}

/**
 * Tells whether one target segment fits one route segment.
 *
 * @param {string} actual - Segment of the goto target.
 * @param {string} expected - Segment of the route.
 * @returns {boolean} True when they fit.
 */
function segmentFits(actual, expected) {
  if (expected.startsWith('[') && expected.endsWith(']')) {
    return actual !== '';
  }
  return actual === expected || actual.includes('${');
}

/**
 * Tells whether a goto target reaches a route.
 *
 * @param {string[]} target - Target segments.
 * @param {string[]} route - Route segments.
 * @returns {boolean} True when the target reaches the route.
 */
export function targetReachesRoute(target, route) {
  const [head, ...rest] = route;
  if (head === undefined) {
    return target.length === 0;
  }
  if (head.startsWith('[[...') && head.endsWith(']]')) {
    return rest.length === 0;
  }
  if (head.startsWith('[...') && head.endsWith(']')) {
    return rest.length === 0 && target.length > 0;
  }
  const [first, ...others] = target;
  return first !== undefined && segmentFits(first, head) && targetReachesRoute(others, rest);
}

/**
 * Checks the Playwright specs of one project against its pages.
 *
 * @param {string} root - Repo root.
 * @param {string} project - Project folder name under projects/.
 * @returns {string[]} Messages in the form `file:line: text`.
 */
export function checkWebProject(root, project) {
  const webFolder = path.join(root, 'projects', project, 'web');
  const specs = readSpecs(root, webFolder);
  if (specs.length === 0) {
    const where = exists(path.join(webFolder, 'e2e'))
      ? 'has no *.spec.ts file'
      : 'has no e2e folder';
    return [
      `projects/${project}/web/e2e:1: the web part ${where}. Add a Playwright spec that calls page.goto and runs an axe check (new-web-page skill).`,
    ];
  }
  const routes = findPageRoutes(root, webFolder);
  if (routes.length === 0) {
    return [
      `projects/${project}/web:1: the web part has no page route (web/app/**/page.tsx or web/src/app/**/page.tsx), so the gate has nothing to check. Add a page, or remove the web part.`,
    ];
  }
  const messages = [];
  for (const route of routes) {
    const reaching = specs.flatMap((spec) =>
      spec.tests
        .filter((test) => test.targets.some((target) => targetReachesRoute(target, route.segments)))
        .map((test) => ({ file: spec.file, hasAxe: test.hasAxe })),
    );
    const shown = `/${route.segments.join('/')}`;
    if (reaching.length === 0) {
      messages.push(
        `${route.file}:1: no Playwright spec calls page.goto('${shown}'). Add one in projects/${project}/web/e2e.`,
      );
    } else if (!reaching.some((test) => test.hasAxe)) {
      messages.push(
        `${reaching[0]?.file ?? route.file}:1: the spec for ${shown} has no axe check in the same test as its page.goto, or the check has no expect(). Use const results = await new AxeBuilder({ page }).analyze(); and expect(results.violations).toEqual([]).`,
      );
    }
  }
  return messages;
}

/**
 * Lists the projects that have a web part.
 *
 * @param {string} root - Repo root.
 * @returns {string[]} Project folder names under projects/.
 */
export function projectsWithWeb(root) {
  return projectsWithParts(root, ['web']);
}
