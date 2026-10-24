// PR size check: counts the lines that a pull request changes (added plus deleted) and compares
// the count with two limits. Lockfiles, generated code and snapshots do not count, because a human
// does not review them line by line.
import { matchesGlob } from './glob.mjs';
import { gitOrThrow } from './proc.mjs';
import { mergeBase } from './revisions.mjs';

/** Above this number of changed lines the check warns. */
export const SIZE_WARN_LINES = 2000;
/** Above this number of changed lines the check fails, unless the PR has the label below. */
export const SIZE_FAIL_LINES = 10000;
/** The label that allows a PR above the fail limit. */
export const LARGE_PR_LABEL = 'large-pr';

/** Paths that do not count. Same matching rules as `gate-files.json` (see `glob.mjs`). */
export const SIZE_EXCLUDED_GLOBS = Object.freeze([
  '**/pnpm-lock.yaml',
  '**/package-lock.json',
  '**/yarn.lock',
  '**/uv.lock',
  '**/go.sum',
  '**/generated/**',
  '**/internal/gen/**',
  '**/__snapshots__/**',
  '**/*.snap',
]);

const GIT_FLAGS = ['--no-optional-locks'];

/**
 * @typedef {object} ChangedFile
 * @property {string} path - New path from the repo root.
 * @property {number} added - Added lines. Zero for a binary file.
 * @property {number} deleted - Deleted lines. Zero for a binary file.
 */

/**
 * Tells whether a path is left out of the size count.
 *
 * @param {string} file - Path from the repo root.
 * @returns {boolean} True for a lockfile, a generated file or a snapshot.
 */
export function isSizeExcluded(file) {
  return SIZE_EXCLUDED_GLOBS.some((pattern) => matchesGlob(file, pattern));
}

/**
 * Parses the output of `git diff --numstat -z -M`. A renamed file has an empty path field and is
 * followed by the old path and the new path.
 *
 * @param {string} output - The output.
 * @returns {ChangedFile[]} One entry for each changed file.
 */
export function parseNumstat(output) {
  const fields = output.split('\0');
  const files = [];
  for (let index = 0; index < fields.length; index += 1) {
    const record = fields[index] ?? '';
    const match = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(record);
    if (match === null) {
      continue;
    }
    let file = match[3] ?? '';
    if (file === '') {
      // Rename or copy: the next two fields are the old and the new path.
      file = fields[index + 2] ?? '';
      index += 2;
    }
    files.push({
      path: file,
      added: match[1] === '-' ? 0 : Number.parseInt(match[1] ?? '0', 10),
      deleted: match[2] === '-' ? 0 : Number.parseInt(match[2] ?? '0', 10),
    });
  }
  return files;
}

/**
 * Lists the files that a PR changes, with their line counts. The diff starts at the merge base of
 * `base` and `head`, so commits that only `base` has are not counted (same rule as `gate-integrity`).
 *
 * @param {string} root - Repo root.
 * @param {string} base - Base commit.
 * @param {string} head - Head commit.
 * @returns {ChangedFile[]} Changed files. It throws when git fails.
 */
export function changedFiles(root, base, head) {
  const from = mergeBase(root, base, head);
  const result = gitOrThrow(root, [
    ...GIT_FLAGS,
    'diff',
    '--numstat',
    '-z',
    '-M',
    '--no-color',
    '--no-ext-diff',
    '--no-textconv',
    '--text',
    from,
    head,
    '--',
  ]);
  return parseNumstat(result.stdout);
}

/**
 * Counts the changed lines of a PR.
 *
 * @param {ChangedFile[]} files - Changed files.
 * @returns {{ lines: number, files: number, excludedFiles: string[] }} The lines that count, the number of files that count, and the paths that were left out.
 */
export function countLines(files) {
  let lines = 0;
  let counted = 0;
  const excludedFiles = [];
  for (const file of files) {
    if (isSizeExcluded(file.path)) {
      excludedFiles.push(file.path);
    } else {
      lines += file.added + file.deleted;
      counted += 1;
    }
  }
  return { lines, files: counted, excludedFiles };
}

/**
 * Judges a line count.
 *
 * @param {number} lines - Changed lines that count.
 * @param {readonly string[]} labels - Labels of the PR.
 * @returns {{ status: 'pass' | 'warn' | 'fail', summary: string }} The status and a one-line text.
 */
export function judgeSize(lines, labels) {
  const text = `${String(lines)} changed lines`;
  if (lines > SIZE_FAIL_LINES) {
    if (labels.includes(LARGE_PR_LABEL)) {
      return {
        status: 'warn',
        summary: `${text}, above ${String(SIZE_FAIL_LINES)}. Allowed by the "${LARGE_PR_LABEL}" label.`,
      };
    }
    return {
      status: 'fail',
      summary: `${text}, above ${String(SIZE_FAIL_LINES)}. Split the PR, or a human adds the "${LARGE_PR_LABEL}" label.`,
    };
  }
  if (lines > SIZE_WARN_LINES) {
    return {
      status: 'warn',
      summary: `${text}, above ${String(SIZE_WARN_LINES)}. Think about splitting the PR.`,
    };
  }
  return { status: 'pass', summary: `${text} (limit ${String(SIZE_WARN_LINES)})` };
}
