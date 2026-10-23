// CI gate check for a pull request. It looks at the range base...head and runs these checks:
//   - gate-files: lists the gate files that the PR changes and sets `riskHigh`. It reports only.
//     CODEOWNERS and the human review decide.
//   - pr-size: counts the changed lines. Warns above 400. Fails above 1000 without the `large-pr` label.
//   - disable-count: counts the markers that switch a check off (lint, type, security and cdk-nag). A net
//     increase fails without the `lint-exception` label.
//   - test-deletion: a deleted test file or fewer test cases in a test file fails without the
//     `test-removal` label. A rename is a move.
// Later parts add more checks. Each check gives `{ name, status, summary, ... }`, and `status` is
// `pass`, `warn` or `fail`.
import { collectDiff } from './lib/diff-source.mjs';
import { collectMarkers, judgeMarkers, LINT_EXCEPTION_LABEL } from './lib/disable-count.mjs';
import { range as gateRange } from './lib/gate-integrity.mjs';
import { antiSkipSettings } from './lib/gate-list.mjs';
import { repositoryRoot } from './lib/git-state.mjs';
import {
  changedFiles,
  countLines,
  judgeSize,
  SIZE_FAIL_LINES,
  SIZE_WARN_LINES,
} from './lib/pr-size.mjs';
import { git } from './lib/proc.mjs';
import { mergeBase, resolveCommit } from './lib/revisions.mjs';
import { findRemovals, judgeRemovals, TEST_REMOVAL_LABEL } from './lib/test-deletion.mjs';

const HELP = `check-gates: check a pull request range: gate files, size, disable markers and removed tests.

Usage:
  node scripts/gates/check-gates.mjs --base <ref> --head <ref> [--labels a,b,c] [--json] [--root <dir>]

Options:
  --base <ref>      the base of the PR (a commit, branch or tag).
  --head <ref>      the head of the PR.
  --labels a,b,c    the labels of the PR, separated by commas. CI passes them.
  --json            print one JSON object { checks, riskHigh, failed } on stdout (the summary goes to stderr).
  --root <dir>      repo root. Default: the git root of the current folder.
  --help            show this text.

Checks:
  gate-files   lists the changed gate files and sets riskHigh. It does not fail by itself.
  pr-size      changed lines (added + deleted; lockfiles, generated code and snapshots do not count).
               Above ${String(SIZE_WARN_LINES)}: warning. Above ${String(SIZE_FAIL_LINES)}: fail, unless the label large-pr is set.
  disable-count  markers that switch a check off (lint, type, security and cdk-nag comments and calls),
               added minus removed. A net increase fails, unless the label ${LINT_EXCEPTION_LABEL} is set.
  test-deletion  a deleted test file, or fewer test cases in a test file, fails, unless the label
               ${TEST_REMOVAL_LABEL} is set. A rename that git detects is a move.

Exit code: 0 no check failed, 1 a check failed, 2 bad usage or a check that could not run.
`;

const VALUE_FLAGS = new Set(['--base', '--head', '--labels', '--root']);
const SWITCH_FLAGS = new Set(['--json', '--help', '-h']);
/** The human summary names this many gate files. The JSON output has all of them. */
const SUMMARY_FILES = 8;

/**
 * @typedef {object} CheckResult
 * @property {string} name - Check name.
 * @property {'pass' | 'warn' | 'fail'} status - Result.
 * @property {string} summary - One line for a human.
 * @property {Record<string, unknown>} [details] - Data for machines.
 */

/**
 * @typedef {object} Report
 * @property {CheckResult[]} checks - The results.
 * @property {boolean} riskHigh - True when the PR changes a gate file.
 * @property {boolean} failed - True when a check failed.
 */

/**
 * Reads the command line.
 *
 * @param {string[]} argv - Arguments after the script name.
 * @returns {{ options: Record<string, string | boolean>, error: string }} Parsed flags.
 */
function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const word = argv[index] ?? '';
    if (VALUE_FLAGS.has(word)) {
      const value = argv[index + 1];
      if (value === undefined) {
        return { options, error: `missing value for ${word}` };
      }
      options[word.slice(2)] = value;
      index += 1;
    } else if (SWITCH_FLAGS.has(word)) {
      options[word.replace(/^-+/, '')] = true;
    } else {
      return { options, error: `unknown argument: ${word}` };
    }
  }
  return { options, error: '' };
}

/**
 * Splits the `--labels` text.
 *
 * @param {string} text - Labels separated by commas.
 * @returns {string[]} The labels, trimmed. Empty entries are dropped.
 */
export function parseLabels(text) {
  return text
    .split(',')
    .map((label) => label.trim())
    .filter((label) => label !== '');
}

/**
 * @typedef {object} CheckContext
 * @property {string} root - Repo root.
 * @property {string} base - Base commit id.
 * @property {string} head - Head commit id.
 * @property {readonly string[]} labels - Labels of the PR.
 * @property {string} start - Start of the range: the merge base of `base` and `head`.
 * @property {import('./lib/diff-parse.mjs').DiffFile[]} files - The changed files with their lines (rename detection on).
 * @property {(file: string) => string | null} readOld - Reads a file as it was at `start`.
 */

/**
 * Check 1: the gate files that the PR changes.
 *
 * @param {CheckContext} context - The repo, the range and the PR labels.
 * @returns {CheckResult} The result. It is always `pass`: the check reports, CODEOWNERS decides.
 */
export function gateFilesCheck(context) {
  const changes = gateRange(context.root, context.base, context.head);
  const files = [...new Set(changes.map((entry) => entry.file))];
  const riskHigh = files.length > 0;
  return {
    name: 'gate-files',
    status: 'pass',
    summary: riskHigh
      ? `risk:high. ${String(files.length)} gate file${files.length === 1 ? '' : 's'} changed: ${files.slice(0, SUMMARY_FILES).join(', ')}${files.length > SUMMARY_FILES ? `, and ${String(files.length - SUMMARY_FILES)} more` : ''}`
      : 'no gate file changed',
    details: { riskHigh, files, changes },
  };
}

/**
 * Check 2: the size of the PR.
 *
 * @param {CheckContext} context - The repo, the range and the PR labels.
 * @returns {CheckResult} The result.
 */
export function prSizeCheck(context) {
  const counted = countLines(changedFiles(context.root, context.base, context.head));
  const judged = judgeSize(counted.lines, context.labels);
  return {
    name: 'pr-size',
    status: judged.status,
    summary: judged.summary,
    details: {
      lines: counted.lines,
      files: counted.files,
      excludedFiles: counted.excludedFiles,
      warnAbove: SIZE_WARN_LINES,
      failAbove: SIZE_FAIL_LINES,
    },
  };
}

/**
 * Check 3: the disable markers that the PR adds and removes.
 *
 * @param {CheckContext} context - The repo, the range and the PR labels.
 * @returns {CheckResult} The result.
 */
export function disableCountCheck(context) {
  const markers = collectMarkers(context.files, antiSkipSettings().ignorePaths);
  const judged = judgeMarkers(markers, context.labels);
  return {
    name: 'disable-count',
    status: judged.status,
    summary: judged.summary,
    details: {
      added: markers.added,
      removed: markers.removed,
      net: markers.added.length - markers.removed.length,
    },
  };
}

/**
 * Check 4: the tests that the PR removes.
 *
 * @param {CheckContext} context - The repo, the range and the PR labels.
 * @returns {CheckResult} The result.
 */
export function testDeletionCheck(context) {
  const found = findRemovals(context.files, context.readOld);
  const judged = judgeRemovals(found.removals, context.labels);
  return {
    name: 'test-deletion',
    status: judged.status,
    summary:
      found.removals.length === 0 && found.moves.length > 0
        ? `${judged.summary} (${String(found.moves.length)} test file${found.moves.length === 1 ? '' : 's'} moved with no loss)`
        : judged.summary,
    details: { removals: found.removals, moves: found.moves },
  };
}

/**
 * Runs all checks.
 *
 * @param {{ root: string, base: string, head: string, labels?: readonly string[] }} input - The repo, the range and the PR labels.
 * @returns {Report} The report. It throws when a revision is bad or git fails, so a check that
 *   cannot run never looks like a pass.
 */
export function runChecks(input) {
  const base = resolveCommit(input.root, input.base);
  const head = resolveCommit(input.root, input.head);
  const start = mergeBase(input.root, base, head);
  const context = {
    root: input.root,
    base,
    head,
    labels: input.labels ?? [],
    start,
    files: collectDiff({ root: input.root, range: `${start}..${head}` }).files,
    readOld: (file) => {
      const shown = git(input.root, ['show', `${start}:${file}`]);
      return shown.status === 0 ? shown.stdout : null;
    },
  };
  const gateFiles = gateFilesCheck(context);
  const checks = [
    gateFiles,
    prSizeCheck(context),
    disableCountCheck(context),
    testDeletionCheck(context),
  ];
  return {
    checks,
    riskHigh: gateFiles.details?.['riskHigh'] === true,
    failed: checks.some((check) => check.status === 'fail'),
  };
}

/**
 * Writes the report as a short text.
 *
 * @param {Report} report - The report.
 * @returns {string} One line for each check and a last line with the result.
 */
export function formatReport(report) {
  const lines = report.checks.map(
    (check) => `${check.status.toUpperCase().padEnd(4)} ${check.name}: ${check.summary}`,
  );
  lines.push(
    `check-gates: ${report.failed ? 'FAILED' : 'pass'} (riskHigh: ${String(report.riskHigh)})`,
  );
  return `${lines.join('\n')}\n`;
}

/**
 * Runs the command.
 *
 * @param {string[]} argv - Arguments after the script name.
 * @returns {number} Exit code.
 */
export function main(argv) {
  const { options, error } = parseArguments(argv);
  if (error !== '') {
    process.stderr.write(`${error}\n\n${HELP}`);
    return 2;
  }
  if (options['help'] === true || options['h'] === true) {
    process.stdout.write(HELP);
    return 0;
  }
  const base = options['base'];
  const head = options['head'];
  if (typeof base !== 'string' || typeof head !== 'string') {
    process.stderr.write(`--base and --head are required\n\n${HELP}`);
    return 2;
  }
  let report;
  try {
    const start = typeof options['root'] === 'string' ? options['root'] : process.cwd();
    report = runChecks({
      root: repositoryRoot(start),
      base,
      head,
      labels: typeof options['labels'] === 'string' ? parseLabels(options['labels']) : [],
    });
  } catch (caught) {
    // A check that cannot run must never look like a pass.
    process.stderr.write(
      `check-gates: could not run: ${caught instanceof Error ? caught.message : String(caught)}\n`,
    );
    return 2;
  }
  if (options['json'] === true) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.stderr.write(formatReport(report));
  } else {
    process.stdout.write(formatReport(report));
  }
  return report.failed ? 1 : 0;
}

if (import.meta.filename === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}
