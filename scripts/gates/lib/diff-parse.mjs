/**
 * @typedef {object} DiffLine
 * @property {'+' | '-'} kind - Added or removed line.
 * @property {string} text - The line without the leading + or -.
 * @property {number} newLine - Line number in the new file (for added lines; for removed lines the place where it was).
 * @property {number} oldLine - Line number in the old file (for removed lines).
 */

/**
 * @typedef {object} DiffFile
 * @property {string} path - New path (or old path for a deleted file).
 * @property {string} oldPath - Old path.
 * @property {'added' | 'modified' | 'deleted' | 'renamed'} status - Change kind.
 * @property {DiffLine[]} lines - Added and removed lines.
 */

const HUNK_HEADER = /^@@ -(\d+)[^+]*\+(\d+)/;
const GIT_HEADER = /^diff --git a\/(.+) b\/(.+)$/;

/**
 * Builds a diff file where every line is added (for an untracked file).
 *
 * @param {string} path - Repo path.
 * @param {string} text - File content.
 * @returns {DiffFile} The diff file.
 */
export function addedFile(path, text) {
  const lines = text.split('\n');
  if (lines.at(-1) === '') {
    lines.pop();
  }
  return {
    path,
    oldPath: path,
    status: 'added',
    lines: lines.map((line, index) => ({ kind: '+', text: line, newLine: index + 1, oldLine: 0 })),
  };
}

/**
 * Reads one header line of a file section.
 *
 * @param {string} line - Header line.
 * @param {DiffFile} file - File being built.
 * @returns {void}
 */
function readFileHeader(line, file) {
  if (line.startsWith('new file mode')) {
    file.status = 'added';
  } else if (line.startsWith('deleted file mode')) {
    file.status = 'deleted';
  } else if (line.startsWith('rename from ')) {
    file.status = 'renamed';
    file.oldPath = line.slice('rename from '.length);
  } else if (line.startsWith('rename to ')) {
    file.path = line.slice('rename to '.length);
  }
}

/**
 * Parses a unified diff (from `git diff`, with any context size).
 *
 * @param {string} text - Diff text.
 * @returns {DiffFile[]} One entry per changed file.
 */
export function parseUnifiedDiff(text) {
  /** @type {DiffFile[]} */
  const files = [];
  /** @type {DiffFile | null} */
  let current = null;
  let inHunk = false;
  let oldLine = 0;
  let newLine = 0;
  for (const line of text.split('\n')) {
    const header = GIT_HEADER.exec(line);
    if (header !== null) {
      current = { path: header[2] ?? '', oldPath: header[1] ?? '', status: 'modified', lines: [] };
      files.push(current);
      inHunk = false;
      continue;
    }
    if (current === null) {
      continue;
    }
    const hunk = HUNK_HEADER.exec(line);
    if (hunk !== null) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
    } else if (!inHunk) {
      readFileHeader(line, current);
    } else if (line.startsWith('+')) {
      current.lines.push({ kind: '+', text: line.slice(1), newLine, oldLine: 0 });
      newLine += 1;
    } else if (line.startsWith('-')) {
      current.lines.push({ kind: '-', text: line.slice(1), newLine, oldLine });
      oldLine += 1;
    } else if (line.startsWith(' ')) {
      oldLine += 1;
      newLine += 1;
    }
  }
  return files;
}
