// Git diff input for scripts/test-guard.mjs: file statuses, added and removed lines, file text.
import { execFileSync } from 'node:child_process';

// Large diffs must not fail the guard (same limit as tooling/vitest-config/src/diff-coverage.ts).
const GIT_MAX_BUFFER = 268_435_456;
const HUNK_START = '@@ ';
const NEW_FILE = '+++ ';
const OLD_FILE = '--- ';
const B_PREFIX = 'b/';
const A_PREFIX = 'a/';

/** Run git in `root` and return stdout. Paths in the output are not quoted. */
export function git(root, args) {
  return execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: GIT_MAX_BUFFER,
  });
}

/**
 * Parse `git diff --name-status -z -M` output.
 * Return [{ status, path, oldPath }]. status is one letter: A, M, D, R, C or T.
 * For A, M, D and T, oldPath equals path.
 */
export function parseNameStatus(text) {
  const parts = text.split('\0').filter((part) => part !== '');
  const entries = [];
  let index = 0;
  while (index < parts.length) {
    const status = parts[index][0];
    if (status === 'R' || status === 'C') {
      entries.push({ status, oldPath: parts[index + 1], path: parts[index + 2] });
      index += 3;
    } else {
      entries.push({ status, oldPath: parts[index + 1], path: parts[index + 1] });
      index += 2;
    }
  }
  return entries;
}

function stripPrefix(name, prefix) {
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

// "-12,3" or "+12" to { start, count }. A missing count is 1.
function range(text) {
  const [start, count] = text.slice(1).split(',');
  return { start: Number(start), count: count === undefined ? 1 : Number(count) };
}

// Start a new hunk. Return the hunk state, or undefined when the line is not a hunk header.
function hunkState(line) {
  if (!line.startsWith(HUNK_START)) return;
  const [, oldRange, newRange] = line.split(' ');
  const before = range(oldRange);
  const after = range(newRange);
  return {
    oldLine: before.start,
    newLine: after.start,
    oldLeft: before.count,
    newLeft: after.count,
  };
}

// Add one hunk body line to the file record.
function addHunkLine(line, hunk, file) {
  if (line.startsWith('+')) {
    file.added.push({ line: hunk.newLine, text: line.slice(1) });
    hunk.newLine += 1;
    hunk.newLeft -= 1;
  } else if (line.startsWith('-')) {
    file.removed.push({ line: hunk.oldLine, text: line.slice(1) });
    hunk.oldLine += 1;
    hunk.oldLeft -= 1;
  }
}

// Read a file header line (--- a/x or +++ b/x) into the file record.
function readHeader(line, file) {
  if (line.startsWith(OLD_FILE)) file.oldPath = stripPrefix(line.slice(OLD_FILE.length), A_PREFIX);
  if (line.startsWith(NEW_FILE)) file.path = stripPrefix(line.slice(NEW_FILE.length), B_PREFIX);
}

/**
 * Parse `git diff -U0 --src-prefix=a/ --dst-prefix=b/` output.
 * Return a Map from the new path (the old path for a deleted file) to
 * { added: [{ line, text }], removed: [{ line, text }] }. Line numbers are 1-based.
 * A hunk line count tells where the hunk ends, so content such as "+++ x" is still content.
 */
export function parsePatch(text) {
  const files = new Map();
  const state = { file: undefined, hunk: undefined };
  for (const line of text.split('\n')) readPatchLine(line, state, files);
  return files;
}

function hunkOpen(hunk) {
  return hunk !== undefined && (hunk.oldLeft > 0 || hunk.newLeft > 0);
}

// Read one line of the patch. `state` holds the current file record and hunk.
function readPatchLine(line, state, files) {
  if (hunkOpen(state.hunk)) {
    addHunkLine(line, state.hunk, state.file);
    return;
  }
  state.hunk = undefined;
  if (line.startsWith('diff --git ')) {
    state.file = { path: '', oldPath: '', added: [], removed: [] };
    return;
  }
  if (state.file === undefined) return;
  readHeader(line, state.file);
  state.hunk = hunkState(line);
  if (state.hunk === undefined) return;
  const { path, oldPath, added, removed } = state.file;
  const key = path === '/dev/null' ? oldPath : path;
  if (!files.has(key)) files.set(key, { added, removed });
}

/** Return the text of `path` at `commit`, or '' when it does not exist there. */
export function fileAt(root, commit, path) {
  try {
    return git(root, ['show', `${commit}:${path}`]);
  } catch {
    return '';
  }
}

/**
 * Read the diff from the merge base of `base` and HEAD to HEAD (the same as `git diff base...HEAD`).
 * Return { mergeBase, entries, patch }.
 */
export function readDiff(root, base) {
  const mergeBase = git(root, ['merge-base', base, 'HEAD']).trim();
  const common = ['diff', '-M', '--no-color', '--no-ext-diff', '--no-textconv', '--no-relative'];
  const range = [mergeBase, 'HEAD'];
  const entries = parseNameStatus(git(root, [...common, '--name-status', '-z', ...range]));
  const patch = parsePatch(
    git(root, [...common, '-U0', '--src-prefix=a/', '--dst-prefix=b/', ...range]),
  );
  return { mergeBase, entries, patch };
}
