// Warn-only notice for the pre-commit hook: lists the staged files that are gate files
// (scripts/gates/gate-files.json). It never blocks a commit: the exit code is 0 even when git fails.
// The gate files need a human review (docs/standards/gates.md, section 6.1).
import { findGate } from './lib/gate-list.mjs';
import { repositoryRoot } from './lib/git-state.mjs';
import { gitOrThrow } from './lib/proc.mjs';

const HELP = `gate-file-notice: list the staged gate files (warn only, never blocks).

Usage:
  node scripts/gates/gate-file-notice.mjs [--root <dir>]

It reads the index (added, changed and deleted files; a rename counts as both names) and prints
one line for each file that matches scripts/gates/gate-files.json. Exit code: always 0.
`;

/** Status letter of a staged change to the words in the notice. */
const STATUS_WORDS = Object.freeze({ A: 'added', D: 'deleted', M: 'changed', T: 'changed' });

/**
 * @typedef {object} StagedGateFile
 * @property {string} file - Path from the repo root.
 * @property {string} change - added, changed or deleted.
 * @property {string} glob - The gate-files.json glob that matched.
 * @property {string} why - The reason from gate-files.json.
 */

/**
 * Lists the staged gate files.
 *
 * @param {string} root - Repo root.
 * @returns {StagedGateFile[]} The staged gate files, in index order. It throws when git fails.
 */
export function stagedGateFiles(root) {
  const listed = gitOrThrow(root, [
    'diff',
    '--cached',
    '--name-status',
    '-z',
    '--no-renames',
    '--no-ext-diff',
    '--',
  ]);
  const fields = listed.stdout.split('\0').filter((field) => field !== '');
  const found = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const status = (fields[index] ?? '').charAt(0);
    const file = fields[index + 1] ?? '';
    const gate = findGate(file);
    if (gate !== null) {
      const change = STATUS_WORDS[/** @type {keyof typeof STATUS_WORDS} */ (status)] ?? 'changed';
      found.push({ file, change, glob: gate.glob, why: gate.why });
    }
  }
  return found;
}

/**
 * Writes the notice.
 *
 * @param {readonly StagedGateFile[]} files - The staged gate files.
 * @returns {string} The notice text, or an empty string when no gate file is staged.
 */
export function formatNotice(files) {
  if (files.length === 0) {
    return '';
  }
  const lines = files.map(
    (entry) => `  ${entry.change} ${entry.file}  (${entry.glob}: ${entry.why})`,
  );
  return [
    `pre-commit: NOTICE (warn only) ${String(files.length)} staged gate file${files.length === 1 ? '' : 's'}:`,
    ...lines,
    'pre-commit: a gate file change needs a human review (docs/standards/gates.md, section 6.1).',
    '',
  ].join('\n');
}

/**
 * Runs the command.
 *
 * @param {string[]} argv - Arguments after the script name.
 * @returns {number} Exit code. Always 0: the notice never blocks.
 */
export function main(argv) {
  let start = process.cwd();
  for (let index = 0; index < argv.length; index += 1) {
    const word = argv[index] ?? '';
    if (word === '--help' || word === '-h') {
      process.stdout.write(HELP);
      return 0;
    }
    const value = argv[index + 1];
    if (word !== '--root' || value === undefined) {
      process.stderr.write(`gate-file-notice: unknown argument: ${word} (warn only, ignored)\n`);
      return 0;
    }
    start = value;
    index += 1;
  }
  try {
    process.stderr.write(formatNotice(stagedGateFiles(repositoryRoot(start))));
  } catch (caught) {
    process.stderr.write(
      `pre-commit: NOTICE (warn only) could not list the staged gate files: ${caught instanceof Error ? caught.message : String(caught)}\n`,
    );
  }
  return 0;
}

if (import.meta.filename === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}
