import path from 'node:path';

import { addedFile, parseUnifiedDiff } from './diff-parse.mjs';
import { readStdin, readText } from './fs-io.mjs';
import { EMPTY_TREE } from './git-state.mjs';
import { git, gitOrThrow } from './proc.mjs';

/**
 * @typedef {object} DiffSource
 * @property {import('./diff-parse.mjs').DiffFile[]} files - Changed files with their lines.
 * @property {(file: string) => string | null} readFile - Reads the new content of a file.
 */

// Flags that make the diff text the same on every machine: user or repo config (`diff.noprefix`,
// textconv, external diff, `-diff` in .gitattributes) must not hide or reshape added lines.
const DIFF_FLAGS = [
  'diff',
  '-U0',
  '--no-color',
  '--no-ext-diff',
  '--no-textconv',
  '--text',
  '--src-prefix=a/',
  '--dst-prefix=b/',
  '-M',
];

/**
 * Splits a git range (`a..b` or `a...b`) into its two sides. An empty side means HEAD.
 *
 * @param {string} range - Range text.
 * @returns {{ start: string, end: string, operator: string }} The sides and the operator.
 */
function splitRange(range) {
  const match = /^(.*?)(\.{2,3})(.*)$/s.exec(range);
  if (match === null) {
    throw new Error(`Bad range "${range}": use a..b or a...b.`);
  }
  return { start: match[1] || 'HEAD', operator: match[2] ?? '..', end: match[3] || 'HEAD' };
}

/**
 * Checks that a revision names a commit, and that it cannot act as a git option.
 *
 * @param {string} root - Repo root.
 * @param {string} revision - Revision text from the command line.
 * @returns {string} The same revision.
 */
function validRevision(root, revision) {
  if (revision === EMPTY_TREE) {
    return revision;
  }
  if (revision === '' || revision.startsWith('-')) {
    throw new Error(
      `Bad revision "${revision}": it must name a commit and must not start with "-".`,
    );
  }
  const check = git(root, [
    'rev-parse',
    '--verify',
    '--quiet',
    '--end-of-options',
    `${revision}^{commit}`,
  ]);
  if (check.status !== 0) {
    throw new Error(`Bad revision "${revision}": git cannot find that commit.`);
  }
  return revision;
}

/**
 * Picks HEAD, or the empty tree in a repo that has no commit yet.
 *
 * @param {string} root - Repo root.
 * @returns {string} Revision to compare the working tree with.
 */
function defaultBase(root) {
  const head = git(root, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']);
  return head.status === 0 ? 'HEAD' : EMPTY_TREE;
}

/**
 * Collects the diff to scan.
 *
 * @param {{ root: string, base?: string, range?: string, staged?: boolean, stdin?: boolean }} options -
 *   `base`: working tree against that commit (untracked files included). `range`: a git range
 *   such as `origin/main...HEAD`. `staged`: the index against HEAD. `stdin`: a unified diff on stdin.
 * @returns {DiffSource} The files and a content reader.
 */
export function collectDiff(options) {
  const { root } = options;
  const workingTreeReader = (file) => readText(path.join(root, file));
  if (options.stdin === true) {
    return { files: parseUnifiedDiff(readStdin()), readFile: workingTreeReader };
  }
  if (options.range !== undefined) {
    const { start, operator, end } = splitRange(options.range);
    const range = `${validRevision(root, start)}${operator}${validRevision(root, end)}`;
    const result = gitOrThrow(root, [...DIFF_FLAGS, range, '--']);
    const readFile = (file) => {
      const shown = git(root, ['show', `${end}:${file}`]);
      return shown.status === 0 ? shown.stdout : null;
    };
    return { files: parseUnifiedDiff(result.stdout), readFile };
  }
  if (options.staged === true) {
    const result = gitOrThrow(root, [...DIFF_FLAGS, '--cached', '--']);
    const readFile = (file) => {
      const shown = git(root, ['show', `:${file}`]);
      return shown.status === 0 ? shown.stdout : null;
    };
    return { files: parseUnifiedDiff(result.stdout), readFile };
  }
  const base = validRevision(root, options.base ?? defaultBase(root));
  const result = gitOrThrow(root, [...DIFF_FLAGS, base, '--']);
  const files = parseUnifiedDiff(result.stdout);
  const untracked = gitOrThrow(root, ['ls-files', '--others', '--exclude-standard', '-z']);
  for (const name of untracked.stdout.split('\0').filter((entry) => entry !== '')) {
    const text = workingTreeReader(name);
    if (text !== null) {
      files.push(addedFile(name, text));
    }
  }
  return { files, readFile: workingTreeReader };
}
