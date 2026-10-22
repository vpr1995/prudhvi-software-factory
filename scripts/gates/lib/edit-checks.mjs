import path from 'node:path';

import { exists } from './fs-io.mjs';
import {
  runEslint,
  runGo,
  runGoBuild,
  runMypy,
  runPrettier,
  runRuff,
  runTsc,
  shouldSkipFile,
} from './project-tools.mjs';
import { findManifestDirectory } from './projects.mjs';

const SCRIPT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']);
const TYPESCRIPT_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);
const PRETTIER_ONLY_EXTENSIONS = new Set([
  '.md',
  '.mdx',
  '.json',
  '.jsonc',
  '.yml',
  '.yaml',
  '.css',
  '.scss',
  '.html',
]);

/**
 * @typedef {object} EditCheck
 * @property {string[]} failures - Problems Claude must fix (the hook exits 2 with them).
 * @property {string[]} notes - Skipped checks and other notices.
 */

/**
 * Resolves an edited path to a file inside the repo.
 *
 * @param {string} root - Repo root.
 * @param {string} rawPath - Path from the tool input.
 * @returns {{ absolute: string, relative: string } | null} The paths, or null when the file is outside the repo, missing or generated.
 */
export function resolveEditedFile(root, rawPath) {
  const absolute = path.resolve(root, rawPath);
  const relative = path.relative(root, absolute).split(path.sep).join('/');
  const outside = relative === '' || relative.startsWith('..') || path.isAbsolute(relative);
  if (outside || shouldSkipFile(relative) || !exists(absolute)) {
    return null;
  }
  return { absolute, relative };
}

/**
 * Formats and lints one script file.
 *
 * @param {string} root - Repo root.
 * @param {string} relative - File path from the repo root.
 * @returns {EditCheck} Result.
 */
function checkScriptFile(root, relative) {
  const result = { failures: [], notes: [] };
  const formatted = runPrettier(root, relative);
  if (formatted.note !== '') {
    result.notes.push(formatted.note);
  } else if (formatted.failed) {
    result.failures.push(`prettier failed on ${relative}:\n${formatted.output}`);
  }
  const linted = runEslint(root, relative);
  if (linted.note !== '') {
    result.notes.push(linted.note);
  } else if (linted.failed) {
    result.failures.push(
      `eslint found problems in ${relative} that --fix cannot fix:\n${linted.output}`,
    );
  }
  return result;
}

/**
 * Formats and lints one Python file.
 *
 * @param {string} root - Repo root.
 * @param {string} relative - File path from the repo root.
 * @param {string} absolute - Absolute file path.
 * @returns {EditCheck} Result.
 */
function checkPythonFile(root, relative, absolute) {
  const manifest = findManifestDirectory(root, absolute);
  const result = runRuff(manifest?.directory ?? root, absolute);
  if (result.note !== '') {
    return { failures: [], notes: [result.note] };
  }
  return {
    failures: result.failed ? [`ruff found problems in ${relative}:\n${result.output}`] : [],
    notes: [],
  };
}

/**
 * Formats and vets one Go file.
 *
 * @param {string} root - Repo root.
 * @param {string} relative - File path from the repo root.
 * @param {string} absolute - Absolute file path.
 * @returns {EditCheck} Result.
 */
function checkGoFile(root, relative, absolute) {
  const manifest = findManifestDirectory(root, absolute);
  if (manifest === null || manifest.marker !== 'go.mod') {
    return { failures: [], notes: [`${relative} has no go.mod above it, Go checks skipped`] };
  }
  const result = runGo(manifest.directory, absolute);
  return {
    failures: result.failed ? [`go vet found problems for ${relative}:\n${result.output}`] : [],
    notes: result.note === '' ? [] : [result.note],
  };
}

/**
 * Runs the after-edit checks for one file: format, then lint, by language.
 *
 * @param {string} root - Repo root.
 * @param {{ absolute: string, relative: string }} file - The edited file.
 * @returns {EditCheck} Failures and notes.
 */
export function checkEditedFile(root, file) {
  const extension = path.extname(file.relative).toLowerCase();
  if (SCRIPT_EXTENSIONS.has(extension)) {
    return checkScriptFile(root, file.relative);
  }
  if (extension === '.py') {
    return checkPythonFile(root, file.relative, file.absolute);
  }
  if (extension === '.go') {
    return checkGoFile(root, file.relative, file.absolute);
  }
  if (PRETTIER_ONLY_EXTENSIONS.has(extension)) {
    const formatted = runPrettier(root, file.relative);
    return {
      failures:
        formatted.failed && formatted.note === ''
          ? [`prettier failed on ${file.relative}:\n${formatted.output}`]
          : [],
      notes: formatted.note === '' ? [] : [formatted.note],
    };
  }
  return { failures: [], notes: [] };
}

/**
 * Runs the typecheck that fits the project that owns an edited file.
 *
 * @param {string} root - Repo root.
 * @param {{ absolute: string, relative: string }} file - The edited file.
 * @returns {EditCheck} Failures and notes.
 */
export function typecheckEditedFile(root, file) {
  const extension = path.extname(file.relative).toLowerCase();
  const manifest = findManifestDirectory(root, file.absolute);
  if (manifest === null) {
    return { failures: [], notes: [] };
  }
  const name = path.relative(root, manifest.directory) || '.';
  let result = null;
  if (TYPESCRIPT_EXTENSIONS.has(extension) && manifest.marker === 'package.json') {
    result = runTsc(manifest.directory);
  } else if (extension === '.py' && manifest.marker === 'pyproject.toml') {
    result = runMypy(manifest.directory);
  } else if (extension === '.go' && manifest.marker === 'go.mod') {
    result = runGoBuild(manifest.directory);
  }
  if (result === null) {
    return { failures: [], notes: [] };
  }
  if (result.note !== '') {
    return { failures: [], notes: [result.note] };
  }
  return {
    failures: result.failed ? [`typecheck failed in ${name}:\n${result.output}`] : [],
    notes: [],
  };
}
