// Test guard: fail a PR that weakens tests or checks (root CLAUDE.md rule 2).
//
// Diff: git diff -M <merge base of BASE and HEAD> HEAD (the same as BASE...HEAD). Only commits
// count. Uncommitted changes do not. A rename is not a deletion.
// Rule 1: a deleted test file (*.test.*, *.spec.*, a Bruno request).
// Rule 2: fewer it( / test( / it.each / test.each call sites in a test file.
// Rule 3: an added .skip, .only, .todo, .fixme, xit( or xdescribe( in a test file.
// Rule 4: an added eslint-disable, @ts-ignore, @ts-expect-error or @ts-nocheck in any file.
// Rule 5: a lowered, removed or changed threshold in the tooling/vitest-config threshold files.
// Rule 6: a changed check config (lint, test, type, knip, commit, audit config, this guard, and
//         the GitHub workflows and actions).
//         A new eslint, vitest or playwright config file is normal in a new project.
// Rules 1 to 5 skip Markdown, test/fixtures/ folders, and tooling/repo-checks/ (rule 6 covers it).
//
// Input: base SHA as the first argument or env BASE_SHA. Labels: env PR_LABELS (JSON array).
// With the risk:high label, each finding is a warning and the exit code is 0.
// Run from the repo root: node tooling/repo-checks/scripts/test-guard.mjs "$(git merge-base main HEAD)"
import { execFileSync } from 'node:child_process';
import { posix } from 'node:path';
import { pathToFileURL } from 'node:url';

import { isGithubActions } from './lib/doc-lint.config.mjs';
import { appendToFile } from './lib/fs-io.mjs';
import { fileAt, readDiff } from './lib/test-guard-diff.mjs';
import {
  CHECK_CONFIG_MESSAGE,
  countTestCases,
  FIRST_LINE,
  isCheckConfig,
  isExempt,
  isTestFile,
  parseLabels,
  RISK_HIGH_LABEL,
  scriptFindings,
  skipFindings,
  suppressionFindings,
  THRESHOLD_FILES,
  thresholdFindings,
} from './lib/test-guard-rules.mjs';
import { baseShaFromEnv, prLabelsFromEnv, stepSummaryPath } from './lib/test-guard.config.mjs';

const EXIT_PASS = 0;
const EXIT_FAIL = 1;
const EXIT_ERROR = 2;
const FIRST_USER_ARGUMENT = 2;
const NO_LINES = { added: [], removed: [] };

// Rule 2 for a modified or renamed test file.
function countFindings({ root, mergeBase }, entry) {
  const before = countTestCases(fileAt(root, mergeBase, entry.oldPath));
  const after = countTestCases(fileAt(root, 'HEAD', entry.path));
  if (after >= before) return [];
  const removed = before - after;
  const message = `test cases went down from ${before} to ${after} (${removed} removed)`;
  return [{ line: FIRST_LINE, message }];
}

// Rule 1: a test file that is deleted, or moved to a non-test or exempt path. Return '' when not.
function removedTestMessage(entry) {
  if (!isTestFile(entry.oldPath) || isExempt(entry.oldPath)) return '';
  if (entry.status === 'D') return 'test file deleted';
  const stillTest = isTestFile(entry.path) && !isExempt(entry.path);
  if (entry.status === 'R' && !stillTest) {
    return `test file moved to a non-test path (from ${entry.oldPath})`;
  }
  return '';
}

// Rules 2 to 5 for one changed file that is not deleted.
function contentFindings(diff, entry, lines) {
  const findings = [...suppressionFindings(lines.added, lines.removed)];
  if (isTestFile(entry.path)) {
    findings.push(...skipFindings(lines.added));
    if (entry.status !== 'A') findings.push(...countFindings(diff, entry));
  }
  if (THRESHOLD_FILES.has(entry.path)) findings.push(...thresholdFindings(lines));
  return findings;
}

// Rule 6 for one changed file: check config paths and package.json scripts.
function configFindings(diff, entry) {
  const changed =
    isCheckConfig(entry.path, entry.status) ||
    (entry.oldPath !== entry.path && isCheckConfig(entry.oldPath, 'M'));
  if (changed) return [{ line: FIRST_LINE, message: CHECK_CONFIG_MESSAGE }];
  if (posix.basename(entry.oldPath) !== 'package.json' || entry.status === 'A') return [];
  const before = fileAt(diff.root, diff.mergeBase, entry.oldPath);
  const after = entry.status === 'D' ? '' : fileAt(diff.root, 'HEAD', entry.path);
  return scriptFindings(before, after);
}

// All findings for one changed file.
function entryFindings(diff, entry) {
  const findings = configFindings(diff, entry);
  const removed = removedTestMessage(entry);
  if (removed !== '') findings.push({ line: FIRST_LINE, message: removed });
  if (entry.status !== 'D' && !isExempt(entry.path)) {
    findings.push(...contentFindings(diff, entry, diff.patch.get(entry.path) ?? NO_LINES));
  }
  return findings;
}

/** Check the diff from the merge base of `base` and HEAD. Return findings { file, line, message }. */
export function guardRepository(root, base) {
  const { mergeBase, entries, patch } = readDiff(root, base);
  const diff = { root, mergeBase, patch };
  return entries.flatMap((entry) =>
    entryFindings(diff, entry).map((finding) => ({ file: entry.path, ...finding })),
  );
}

/** Format one finding. GitHub Actions gets an annotation of the given level (error or warning). */
export function formatFinding(finding, github, level) {
  if (!github) return `${finding.file}:${finding.line}: ${finding.message}`;
  const message = finding.message
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A');
  return `::${level} file=${finding.file},line=${finding.line}::${message}`;
}

/** Markdown for $GITHUB_STEP_SUMMARY. */
export function summaryMarkdown(findings, allowed) {
  const verdict = allowed
    ? `The PR has the \`${RISK_HIGH_LABEL}\` label, so these are warnings.`
    : `Add the \`${RISK_HIGH_LABEL}\` label only when a human approves the change.`;
  const items = findings.map(
    (finding) => `- \`${finding.file}:${finding.line}\` ${finding.message}`,
  );
  return `## Test guard: ${findings.length} findings\n\n${verdict}\n\n${items.join('\n')}\n`;
}

function report(findings, allowed) {
  const github = isGithubActions();
  const lines = findings.map((finding) =>
    formatFinding(finding, github, allowed ? 'warning' : 'error'),
  );
  const summary = stepSummaryPath();
  if (summary !== '') appendToFile(summary, summaryMarkdown(findings, allowed));
  const tail = allowed
    ? `test-guard: ${findings.length} findings, allowed by the ${RISK_HIGH_LABEL} label`
    : `test-guard: ${findings.length} findings. A human must approve and add the ${RISK_HIGH_LABEL} label`;
  process.stderr.write(`${lines.join('\n')}\n${tail}\n`);
}

export function main(argv = process.argv) {
  const base = argv[FIRST_USER_ARGUMENT] ?? baseShaFromEnv();
  if (base === '') {
    process.stderr.write('test-guard: give the base SHA as the first argument or in BASE_SHA\n');
    return EXIT_ERROR;
  }
  let labels;
  try {
    labels = parseLabels(prLabelsFromEnv());
  } catch (error) {
    process.stderr.write(`test-guard: PR_LABELS is not valid: ${error.message}\n`);
    return EXIT_ERROR;
  }
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  let findings;
  try {
    findings = guardRepository(root, base);
  } catch (error) {
    process.stderr.write(`test-guard: git failed: ${error.message}\n`);
    return EXIT_ERROR;
  }
  if (findings.length === 0) {
    process.stdout.write('test-guard: ok\n');
    return EXIT_PASS;
  }
  const allowed = labels.includes(RISK_HIGH_LABEL);
  report(findings, allowed);
  return allowed ? EXIT_PASS : EXIT_FAIL;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
