// Prettier check: finds the files that Prettier must check and runs `prettier --list-different` on
// them. The pre-commit hook formats staged code with `prettier --write` (lint-staged); this check
// catches the files that reached a commit without it.
//
// Files: tracked regular files (no symlinks, no submodules) with an extension that lint-staged
// formats, plus Markdown. Prettier's own ignore files (the root .gitignore and .prettierignore) remove
// files. Diff mode keeps the files that committed changes since the base (`base...HEAD`) added or
// changed. A deleted file drops out, and a renamed file counts with its new path only.
import path from 'node:path';

import { exists } from './fs-io.mjs';
import { gitOrThrow, run } from './proc.mjs';
import { mergeBase, resolveCommit } from './revisions.mjs';

/** The Prettier of the rush-lint-staged autoinstaller: the binary the pre-commit hook uses. */
export const PRETTIER_BIN = 'common/autoinstallers/rush-lint-staged/node_modules/.bin/prettier';
/** The extensions of .lintstagedrc.cjs, plus Markdown. */
export const PRETTIER_EXTENSIONS = Object.freeze([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.jsonc',
  '.yml',
  '.yaml',
  '.css',
  '.md',
]);
/** The ignore files that Prettier 3 reads by default, from the repo root. */
export const IGNORE_FILES = Object.freeze(['.gitignore', '.prettierignore']);
/** Files for each Prettier call, so the command line stays short. */
export const BATCH_SIZE = 100;
/** git modes of regular files (normal and executable). */
const REGULAR_MODES = new Set(['100644', '100755']);
const PRETTIER_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_ERROR_CHARS = 2000;

/**
 * @param {string} file - Path from the repo root.
 * @returns {boolean} True when the extension is one that the check covers.
 */
export function handledPath(file) {
  return PRETTIER_EXTENSIONS.includes(path.posix.extname(file).toLowerCase());
}

/**
 * @param {string} root - Repo root.
 * @param {string[]} args - git arguments.
 * @returns {string[]} The NUL-separated entries of the output.
 */
function gitList(root, args) {
  return gitOrThrow(root, ['--no-optional-locks', ...args])
    .stdout.split('\0')
    .filter((entry) => entry !== '');
}

/**
 * Lists the tracked regular files. Symlinks (mode 120000) and submodules (160000) are not files that
 * Prettier can check: it fails on a symlink that it gets by name.
 *
 * @param {string} root - Repo root.
 * @returns {string[]} Paths from the repo root.
 */
export function trackedRegularFiles(root) {
  const files = [];
  for (const entry of gitList(root, ['ls-files', '--stage', '-z'])) {
    const tab = entry.indexOf('\t');
    const mode = entry.slice(0, entry.indexOf(' '));
    if (tab > 0 && REGULAR_MODES.has(mode)) {
      files.push(entry.slice(tab + 1));
    }
  }
  return [...new Set(files)];
}

/**
 * Lists the paths that committed changes since the base added or changed (`base...HEAD`). Deleted
 * paths are not listed. A rename is a delete plus an add, so only the new path is listed.
 *
 * @param {string} root - Repo root.
 * @param {string} base - Base commit id.
 * @returns {string[]} Paths from the repo root.
 */
export function changedFiles(root, base) {
  const start = mergeBase(root, base, resolveCommit(root, 'HEAD'));
  return gitList(root, [
    'diff',
    '--name-only',
    '-z',
    '--no-renames',
    '--no-ext-diff',
    '--diff-filter=d',
    start,
    'HEAD',
    '--',
  ]);
}

/**
 * Lists the tracked files that Prettier's ignore files match. git reads them with the same
 * gitignore rules that Prettier uses.
 *
 * @param {string} root - Repo root.
 * @returns {Set<string>} Paths from the repo root.
 */
export function ignoredFiles(root) {
  const sources = IGNORE_FILES.filter((name) => exists(path.join(root, name)));
  if (sources.length === 0) {
    return new Set();
  }
  return new Set(
    gitList(root, [
      'ls-files',
      '-z',
      '--cached',
      '--ignored',
      ...sources.map((name) => `--exclude-from=${name}`),
    ]),
  );
}

/**
 * Picks the files to check.
 *
 * @param {{ root: string, base: string, full: boolean }} options - Repo root, base commit id, and
 *   full mode (every tracked file).
 * @returns {string[]} Sorted paths from the repo root.
 */
export function selectFiles(options) {
  const { root, base, full } = options;
  const tracked = trackedRegularFiles(root);
  const regular = new Set(tracked);
  const candidates = full ? tracked : changedFiles(root, base).filter((file) => regular.has(file));
  const ignored = ignoredFiles(root);
  return candidates
    .filter((file) => handledPath(file) && !ignored.has(file) && exists(path.join(root, file)))
    .sort();
}

/**
 * Runs `prettier --list-different` on the files, in batches.
 *
 * @param {string} root - Repo root.
 * @param {string[]} files - Paths from the repo root.
 * @returns {{ unformatted: string[], error: string }} Files that Prettier would change, and an error
 *   text when Prettier could not check a batch (empty when every batch ran).
 */
export function listUnformatted(root, files) {
  const binary = path.join(root, PRETTIER_BIN);
  /** @type {string[]} */
  const unformatted = [];
  for (let start = 0; start < files.length; start += BATCH_SIZE) {
    const batch = files.slice(start, start + BATCH_SIZE);
    const result = run(binary, ['--list-different', '--', ...batch], {
      cwd: root,
      timeoutMs: PRETTIER_TIMEOUT_MS,
    });
    const listed = result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');
    // Exit 1 with names: files to format. Any other failure (exit 2 for a syntax error, 127, a
    // timeout, or exit 1 with no names) means Prettier did not check the batch.
    if (result.status === 0 || (result.status === 1 && listed.length > 0)) {
      unformatted.push(...listed);
      continue;
    }
    const detail = `${result.stderr}${result.stdout}`.trim().slice(0, MAX_ERROR_CHARS);
    return {
      unformatted,
      error: `prettier exited ${String(result.status)}${result.timedOut ? ' (timeout)' : ''}${detail === '' ? '' : `:\n${detail}`}`,
    };
  }
  return { unformatted, error: '' };
}

/**
 * @param {string[]} files - Files to format.
 * @returns {string} The command that formats them.
 */
export function fixCommand(files) {
  return `${PRETTIER_BIN} --write ${files.map((file) => `'${file.replaceAll("'", "'\\''")}'`).join(' ')}`;
}

/**
 * Runs the gate.
 *
 * @param {{ root: string, base: string, full: boolean, write: (text: string) => void, writeError: (text: string) => void }} options -
 *   Repo root, base revision, full mode, and the output writers.
 * @returns {number} Exit code: 0 when every file is formatted, 1 otherwise.
 */
export function runPrettierGate(options) {
  const { root, full, write, writeError } = options;
  if (!exists(path.join(root, PRETTIER_BIN))) {
    writeError(
      `prettier: FAIL the Prettier binary is missing at ${PRETTIER_BIN}. Install the rush-lint-staged autoinstaller: node common/scripts/install-run-rush.js install-autoinstaller --name rush-lint-staged\n`,
    );
    return 1;
  }
  const base = resolveCommit(root, options.base);
  const files = selectFiles({ root, base, full });
  const scope = full ? 'all tracked files: GATES_FULL=1' : `changed since ${base.slice(0, 12)}`;
  write(`prettier: checking ${String(files.length)} files (${scope})\n`);
  if (files.length === 0) {
    write('prettier: pass (0 files)\n');
    return 0;
  }
  const { unformatted, error } = listUnformatted(root, files);
  if (error !== '') {
    writeError(`prettier: FAIL ${error}\n`);
    return 1;
  }
  if (unformatted.length === 0) {
    write(`prettier: pass (${String(files.length)} files)\n`);
    return 0;
  }
  writeError(
    [
      `prettier: FAIL ${String(unformatted.length)} of ${String(files.length)} files are not formatted:`,
      ...unformatted.map((file) => `  ${file}`),
      'Fix: format them, check the diff, then commit:',
      `  ${fixCommand(unformatted)}`,
      '',
    ].join('\n'),
  );
  return 1;
}
