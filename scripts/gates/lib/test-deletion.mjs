// Test deletion: finds the tests that a PR removes. It fails unless the PR has the label
// `test-removal`. It counts three cases:
//   - a deleted test file (a Bruno request counts only when it had an assert or tests block),
//   - a renamed test file whose new path is not a test path,
//   - a test file with fewer test cases than before (cases removed minus cases added in the file).
// A rename that git detects (`-M`) is a move, not a deletion. A moved file with the same or more
// cases passes. The test file patterns and the case counter are the ones of the anti-skip scanner.
import { isTestFile, languageOf, testCasesInLine } from './anti-skip-rules.mjs';

/** The label that allows a PR to remove tests. */
export const TEST_REMOVAL_LABEL = 'test-removal';

const BRUNO_TEST_BLOCK = /^(?:assert|tests)\s*\{/m;
const MAX_LISTED = 8;

/**
 * @typedef {object} Removal
 * @property {string} file - Path of the test file (the old path for a deleted or moved file).
 * @property {number} line - Line number in the old file.
 * @property {'deleted' | 'moved-out' | 'fewer-cases'} kind - What happened.
 * @property {string} detail - A short text.
 */

/**
 * Counts the test cases that the lines of a changed file add and remove.
 *
 * @param {import('./diff-parse.mjs').DiffFile} file - A changed file.
 * @returns {{ added: number, removed: number, firstRemovedLine: number }} The counts.
 */
function caseChanges(file) {
  const language = languageOf(file.path);
  let added = 0;
  let removed = 0;
  let firstRemovedLine = 1;
  for (const line of file.lines) {
    const cases = testCasesInLine(line.text, language);
    if (line.kind === '+') {
      added += cases;
    } else if (cases > 0) {
      if (removed === 0) {
        firstRemovedLine = line.oldLine;
      }
      removed += cases;
    }
  }
  return { added, removed, firstRemovedLine };
}

/**
 * Judges one changed file.
 *
 * @param {import('./diff-parse.mjs').DiffFile} file - A changed file.
 * @param {(path: string) => string | null} readOld - Reads a file as it was at the start of the range.
 * @returns {Removal | null} The removal, or null.
 */
function removalOf(file, readOld) {
  if (file.status === 'added' || !isTestFile(file.oldPath)) {
    return null;
  }
  if (file.status === 'deleted') {
    if (languageOf(file.oldPath) === 'bru') {
      const old = readOld(file.oldPath);
      if (old !== null && !BRUNO_TEST_BLOCK.test(old)) {
        return null;
      }
    }
    return { file: file.oldPath, line: 1, kind: 'deleted', detail: 'test file deleted' };
  }
  if (file.status === 'renamed' && !isTestFile(file.path)) {
    return {
      file: file.oldPath,
      line: 1,
      kind: 'moved-out',
      detail: `moved to ${file.path}, which is not a test path`,
    };
  }
  const changes = caseChanges(file);
  if (changes.removed <= changes.added) {
    return null;
  }
  return {
    file: file.oldPath,
    line: changes.firstRemovedLine,
    kind: 'fewer-cases',
    detail: `fewer test cases (${String(changes.removed)} removed, ${String(changes.added)} added)`,
  };
}

/**
 * Finds the tests that a diff removes.
 *
 * @param {import('./diff-parse.mjs').DiffFile[]} files - Changed files with their lines (from a diff with rename detection).
 * @param {(path: string) => string | null} readOld - Reads a file as it was at the start of the range (null when missing).
 * @returns {{ removals: Removal[], moves: { from: string, to: string }[] }} The removals, and the test files that moved with no loss.
 */
export function findRemovals(files, readOld) {
  const removals = [];
  const moves = [];
  for (const file of files) {
    const removal = removalOf(file, readOld);
    if (removal !== null) {
      removals.push(removal);
    } else if (file.status === 'renamed' && isTestFile(file.oldPath)) {
      moves.push({ from: file.oldPath, to: file.path });
    }
  }
  return { removals, moves };
}

/**
 * Judges the removals of a PR.
 *
 * @param {Removal[]} removals - From `findRemovals`.
 * @param {readonly string[]} labels - Labels of the PR.
 * @returns {{ status: 'pass' | 'warn' | 'fail', summary: string }} The status and a one-line text.
 */
export function judgeRemovals(removals, labels) {
  if (removals.length === 0) {
    return { status: 'pass', summary: 'no test removed' };
  }
  const listed = removals
    .slice(0, MAX_LISTED)
    .map((entry) => `${entry.file}:${String(entry.line)} (${entry.detail})`)
    .join(', ');
  const more =
    removals.length > MAX_LISTED ? `, and ${String(removals.length - MAX_LISTED)} more` : '';
  const text = `${String(removals.length)} removal${removals.length === 1 ? '' : 's'}: ${listed}${more}`;
  if (labels.includes(TEST_REMOVAL_LABEL)) {
    return { status: 'warn', summary: `${text}. Allowed by the "${TEST_REMOVAL_LABEL}" label.` };
  }
  return {
    status: 'fail',
    summary: `${text}. Restore the tests, or a human adds the "${TEST_REMOVAL_LABEL}" label.`,
  };
}
