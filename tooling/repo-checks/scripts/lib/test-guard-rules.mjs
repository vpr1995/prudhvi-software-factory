// Rules for scripts/test-guard.mjs. Pure functions: no git, no file system.
import { posix } from 'node:path';

export const FIRST_LINE = 1;
export const RISK_HIGH_LABEL = 'risk:high';
export const CHECK_CONFIG_MESSAGE = 'check config changed; needs risk:high';

const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
// Bruno files that are not requests: collection and folder settings, environments.
const BRUNO_SETTINGS = new Set(['collection.bru', 'folder.bru']);
// it( test( it.each test.each. The look-behind keeps submit(, xit( and foo.it( out of the count.
const TEST_CASE = /(?<![\w$.])(?:it|test)(?:\.each)?\s*[(`]/g;
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT = /^\s*\/\/.*$/gm;
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/;
// describe.skip, it.only, test.todo, test.describe.only, test.fixme.
const FOCUS_OR_SKIP = /(?<![\w$.])(?:it|test|describe)(?:\.describe)?\.(?:skip|only|todo|fixme)\b/;
const X_PREFIXED = /(?<![\w$.])x(?:it|test|describe)\s*\(/;
const LINT_DISABLE = /eslint-disable/;
const TS_DIRECTIVE = /@ts-(?:ignore|expect-error|nocheck)\b/;
// Coverage threshold keys and threshold constants: `lines: 80`, `FOO_THRESHOLD = 80`.
const SETTING = /(\w+) ?[:=] ?([\w.]+)/g;
const COVERAGE_KEYS = new Set(['lines', 'branches', 'functions', 'statements']);
const NUMBER = /^[\d.]+$/;

export const THRESHOLD_FILES = new Set([
  'tooling/vitest-config/src/config.ts',
  'tooling/vitest-config/src/diff-coverage.ts',
]);

// A change to these files (by base name) is a finding. An added file is normal in a new project.
const PROJECT_CHECK_CONFIG = /^(?:eslint|vitest|playwright)\.config\.[cm]?[jt]s$/;
// A change to these files (by base name) is a finding, also when the file is new.
const REPO_CHECK_CONFIG = new Set([
  'knip.jsonc',
  '.lintstagedrc.cjs',
  'commitlint.config.cjs',
  'audit-ci.jsonc',
]);
const CHECK_CONFIG_FOLDERS = [
  'tooling/eslint-config/',
  'tooling/vitest-config/',
  'tooling/repo-checks/',
  '.github/workflows/',
  '.github/actions/',
];
const TSCONFIG_PRESET = /^tooling\/tsconfig\/[^/]+\.json$/;

/** True for a test file: *.test.*, *.spec.* (Playwright e2e included) and Bruno requests. */
export function isTestFile(file) {
  const name = posix.basename(file);
  if (name.endsWith('.bru')) {
    return !BRUNO_SETTINGS.has(name) && !file.split('/').includes('environments');
  }
  return TEST_FILE.test(name);
}

/**
 * True when rules 1 to 5 skip the file: Markdown, test fixtures, and the guard's own package
 * (its source and tests hold the patterns). Rule 6 still sees tooling/repo-checks/**.
 */
export function isExempt(file) {
  return (
    file.endsWith('.md') ||
    file.includes('/test/fixtures/') ||
    file.startsWith('test/fixtures/') ||
    file.startsWith('tooling/repo-checks/')
  );
}

/** True when a change to the file changes how tests, lint or types are checked. */
export function isCheckConfig(file, status) {
  if (file.endsWith('.md')) return false;
  const name = posix.basename(file);
  if (PROJECT_CHECK_CONFIG.test(name)) return status !== 'A';
  return (
    REPO_CHECK_CONFIG.has(name) ||
    TSCONFIG_PRESET.test(file) ||
    CHECK_CONFIG_FOLDERS.some((folder) => file.startsWith(folder))
  );
}

/** Count the test cases in a test file: it(, test(, it.each and test.each. Comments do not count. */
export function countTestCases(text) {
  const code = text.replaceAll(BLOCK_COMMENT, '').replaceAll(LINE_COMMENT, '');
  return [...code.matchAll(TEST_CASE)].length;
}

/** Findings for the added lines of one test file: skipped, focused or todo tests. */
export function skipFindings(added) {
  return added
    .filter(({ text }) => !COMMENT_LINE.test(text))
    .filter(({ text }) => FOCUS_OR_SKIP.test(text) || X_PREFIXED.test(text))
    .map(({ line }) => ({ line, message: 'added a skipped, focused or todo test' }));
}

/** Findings for the added lines of any file: eslint-disable and TypeScript ignore comments. */
export function suppressionFindings(added) {
  const findings = [];
  for (const { line, text } of added) {
    if (LINT_DISABLE.test(text))
      findings.push({ line, message: 'added an eslint-disable comment' });
    const directive = TS_DIRECTIVE.exec(text);
    if (directive !== null) findings.push({ line, message: `added a ${directive[0]} comment` });
  }
  return findings;
}

function isThresholdKey(key) {
  return COVERAGE_KEYS.has(key) || key.includes('THRESHOLD');
}

// Map from threshold key to its first { line, value } in the lines.
function thresholdSettings(lines) {
  const settings = new Map();
  for (const { line, text } of lines) {
    for (const [, key, value] of text.matchAll(SETTING)) {
      if (isThresholdKey(key) && !settings.has(key)) settings.set(key, { line, value });
    }
  }
  return settings;
}

// The finding message for one changed threshold, or '' when the change does not lower it.
function thresholdChange(key, before, after) {
  if (after === undefined) return `threshold ${key} (${before}) removed`;
  if (NUMBER.test(before) && NUMBER.test(after)) {
    return Number(after) < Number(before)
      ? `threshold ${key} lowered from ${before} to ${after}`
      : '';
  }
  return before === after ? '' : `threshold ${key} changed from ${before} to ${after}`;
}

/**
 * Findings for a threshold file: a removed setting that comes back lower, as a non-number, or
 * not at all. A raised number passes.
 */
export function thresholdFindings({ added, removed }) {
  const before = thresholdSettings(removed);
  const after = thresholdSettings(added);
  const findings = [];
  for (const [key, old] of before) {
    const now = after.get(key);
    const message = thresholdChange(key, old.value, now?.value);
    if (message !== '') findings.push({ line: now?.line ?? FIRST_LINE, message });
  }
  return findings;
}

/** Parse PR_LABELS (a JSON array of names). Unset or empty means no labels. Throw when invalid. */
export function parseLabels(raw) {
  if (raw === undefined || raw.trim() === '') return [];
  const labels = JSON.parse(raw);
  if (!Array.isArray(labels) || !labels.every((label) => typeof label === 'string')) {
    throw new TypeError('PR_LABELS must be a JSON array of strings');
  }
  return labels;
}
