// Renders the gate fixtures report (docs/standards/gate-fixtures.md). The step "Prettier check" of
// the local gate runner checks Markdown, so the tables are padded the way Prettier pads them:
// every cell is as wide as the widest cell of its column, and the separator row is all dashes.
import { summarize } from './gate-fixtures-run.mjs';

const HEADERS = ['Id', 'Plan row', 'Bad change', 'Gate', 'Expected', 'Result', 'Detail'];

const NOTES = [
  'Each fixture runs in a throwaway `git worktree` of HEAD under the OS temp folder. The worktree is reset to the start commit before every fixture and removed at the end. The script does not change a tracked file of the main working tree, except this report. Git writes the worktree record to `.git/worktrees`, and a tool can write its cache to a `node_modules` folder of the main tree.',
  'A fixture marked "needs agent A", "needs agent B" or "needs agent C" tests a rule that is in a handoff file. It fails until a human applies that handoff file.',
  'The code under test (hook scripts, `scripts/gates/*.mjs`, the ESLint and Opengrep tools) is read from the main working tree, so a gate file that a human applied but did not commit is tested. The worktree holds only the bad change.',
  'A PASS (rejected) row means the gate exited with the expected code and printed the expected text. A control row is a clean change that the gate must accept: exit 0 and, where the row shows one, a sentinel text that proves the gate ran on the change. A FAIL row means the gate did not reject the bad change: that gate does not exist.',
  'A row marked SKIP (CI, later) is proven by a CI job only. A row marked SKIP (slow) needs the `--slow` flag.',
];

/**
 * Makes one table cell: one line, no pipe character.
 *
 * @param {string | number} value - The cell text.
 * @returns {string} The cell.
 */
function cell(value) {
  return String(value)
    .replaceAll(/\s+/g, ' ')
    .replaceAll('|', String.raw`\|`)
    .trim();
}

/**
 * Wraps text in a code span so that Markdown does not change it. A backtick inside becomes a quote.
 *
 * @param {string} text - Raw text.
 * @returns {string} The code span, or an empty string for empty text.
 */
function code(text) {
  return text === '' ? '' : `\`${cell(text.replaceAll('`', "'"))}\``;
}

/**
 * Renders a Markdown table the way Prettier prints it.
 *
 * @param {string[]} headers - Column names.
 * @param {string[][]} rows - Cells of each row (already made safe with `cell`).
 * @returns {string} The table, without a final newline.
 */
export function renderTable(headers, rows) {
  const widths = headers.map((header, column) =>
    Math.max(3, header.length, ...rows.map((row) => (row[column] ?? '').length)),
  );
  const line = (cells) =>
    `| ${cells.map((text, column) => text.padEnd(widths[column] ?? 0)).join(' | ')} |`;
  return [
    line(headers),
    `| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`,
    ...rows.map((row) => line(row)),
  ].join('\n');
}

/**
 * Renders the whole report.
 *
 * @param {object} meta - What the report states.
 * @param {string} meta.date - The date (YYYY-MM-DD).
 * @param {string} meta.commit - The HEAD commit (short id).
 * @param {string[]} meta.dirtyGates - Gate files of the main tree that are not committed.
 * @param {string} meta.mode - For example `all fixtures` or `--only a,b`.
 * @param {boolean} meta.slow - Whether the slow fixtures were asked for.
 * @param {Record<string, string | number>[]} meta.rows - Rows from `runAll`.
 * @returns {string} Markdown, with a final newline.
 */
export function renderReport(meta) {
  const counts = summarize(meta.rows);
  const dirty =
    meta.dirtyGates.length === 0 ? 'none' : meta.dirtyGates.map((file) => `\`${file}\``).join(', ');
  const table = renderTable(
    HEADERS,
    meta.rows.map((row) => [
      code(String(row['id'])),
      cell(String(row['row'])),
      cell(String(row['change'])),
      cell(String(row['gate'])),
      code(String(row['expected'])),
      cell(String(row['result'])),
      code(String(row['detail'])),
    ]),
  );
  return [
    '# Gate fixtures',
    '',
    'Written by `node scripts/gates/gate-fixtures.mjs`. Do not edit it by hand. Plan section 11: each bad change must be rejected. A change that is not rejected shows a gate that does not exist.',
    '',
    `- Date: ${meta.date}`,
    `- Commit: \`${meta.commit}\``,
    `- Gate files of the main tree with an uncommitted change: ${dirty}`,
    `- Run: ${meta.mode}, slow fixtures ${meta.slow ? 'included' : 'not included'}`,
    `- Summary: ${String(counts.pass)} pass, ${String(counts.fail)} fail, ${String(counts.skip)} skip`,
    '',
    '## Results',
    '',
    table,
    '',
    '## How to read this',
    '',
    ...NOTES.map((note) => `- ${note}`),
    '',
  ].join('\n');
}
