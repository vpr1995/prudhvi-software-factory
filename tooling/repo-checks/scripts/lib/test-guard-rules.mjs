// Rules for scripts/test-guard.mjs. Pure functions: no git, no file system.
import { posix } from 'node:path';

export const FIRST_LINE = 1;
export const RISK_HIGH_LABEL = 'risk:high';
export const CHECK_CONFIG_MESSAGE = 'check config changed; needs risk:high';

const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
// Bruno files that are not requests: collection and folder settings, environments.
const BRUNO_SETTINGS = new Set(['collection.bru', 'folder.bru']);
// The start of a test call chain: it, test or describe. The look-behind keeps submit(, xit( and
// foo.it( out.
const CHAIN_ROOT = /(?<![\w$.])(?:it|test|describe)\b/g;
const WORD = /\w+/y;
const SPACE = /\s*/y;
// Chain segments of one test case: it.each(...)(...), it.concurrent(...), it.skipIf(x)(...).
const CASE_SEGMENTS = new Set([
  'each',
  'concurrent',
  'sequential',
  'fails',
  'for',
  'skipIf',
  'runIf',
  'skip',
  'only',
  'todo',
  'fixme',
]);
// Chain segments that take arguments before the test call: it.skipIf(x)('name', ...).
const CONDITION_SEGMENTS = new Set(['skipIf', 'runIf']);
const SKIP_SEGMENTS = new Set(['skip', 'skipIf', 'only', 'todo', 'fixme']);
// A line that starts a comment or continues a block comment. Its code does not count.
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/;
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
// A change to a project tsconfig is a finding. An added file is normal in a new project.
const PROJECT_TSCONFIG = /^tsconfig[\w.-]*\.json$/;
// A change to these exact paths is a finding.
const CHECK_CONFIG_PATHS = new Set([
  'common/config/rush/command-line.json',
  '.github/zizmor.yml',
  '.github/CODEOWNERS',
]);

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
  if (PROJECT_CHECK_CONFIG.test(name) || PROJECT_TSCONFIG.test(name)) {
    return status !== 'A' || TSCONFIG_PRESET.test(file);
  }
  return (
    CHECK_CONFIG_PATHS.has(file) ||
    REPO_CHECK_CONFIG.has(name) ||
    TSCONFIG_PRESET.test(file) ||
    CHECK_CONFIG_FOLDERS.some((folder) => file.startsWith(folder))
  );
}

// Return the index after the "(...)" that opens at `open`, or -1 when it does not close.
function afterParentheses(code, open) {
  let depth = 0;
  for (let index = open; index < code.length; index += 1) {
    if (code[index] === '(') depth += 1;
    if (code[index] === ')') depth -= 1;
    if (depth === 0) return index + 1;
  }
  return -1;
}

// Read the chain after a root at `index`: ".concurrent.skipIf(x)". Return { segments, called }.
// `called` is true when a call "(" or a tagged template "`" follows the chain.
function readChain(code, index) {
  const segments = [];
  let position = index;
  while (code[position] === '.') {
    WORD.lastIndex = position + 1;
    const word = WORD.exec(code);
    if (word === null) return { segments, called: false };
    segments.push(word[0]);
    position = WORD.lastIndex;
    if (CONDITION_SEGMENTS.has(word[0])) {
      position = afterParentheses(code, position);
      if (position === -1) return { segments, called: false };
    }
  }
  SPACE.lastIndex = position;
  SPACE.exec(code);
  return { segments, called: code[SPACE.lastIndex] === '(' || code[SPACE.lastIndex] === '`' };
}

// Each it, test or describe chain in the code: { root, segments, called }.
function testChains(code) {
  return [...code.matchAll(CHAIN_ROOT)].map((match) => ({
    root: match[0],
    ...readChain(code, match.index + match[0].length),
  }));
}

function isTestCase({ root, segments, called }) {
  return called && root !== 'describe' && segments.every((segment) => CASE_SEGMENTS.has(segment));
}

/**
 * Count the test cases in a test file: it( and test( calls, with modifiers such as .each,
 * .concurrent and .skipIf(x). A describe block is not a test case. Comment lines do not count.
 */
export function countTestCases(text) {
  const code = text
    .split('\n')
    .filter((line) => !COMMENT_LINE.test(line))
    .join('\n');
  return testChains(code).filter((chain) => isTestCase(chain)).length;
}

function isSkipped(text) {
  const chains = testChains(text);
  return (
    X_PREFIXED.test(text) ||
    chains.some(
      ({ segments, called }) => called && segments.some((segment) => SKIP_SEGMENTS.has(segment)),
    )
  );
}

/** Findings for the added lines of one test file: skipped, focused or todo tests. */
export function skipFindings(added) {
  return added
    .filter(({ text }) => !COMMENT_LINE.test(text) && isSkipped(text))
    .map(({ line }) => ({ line, message: 'added a skipped, focused or todo test' }));
}

/**
 * Findings for the added lines of any file: eslint-disable and TypeScript ignore comments.
 * A line that the same diff also removes (same trimmed text) only moved. It is not a finding.
 */
export function suppressionFindings(added, removed = []) {
  const moved = new Set(removed.map(({ text }) => text.trim()));
  const findings = [];
  for (const { line, text } of added.filter((entry) => !moved.has(entry.text.trim()))) {
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

// The "scripts" object of a package.json text. Missing text or scripts give an empty Map.
function scriptsOf(text) {
  if (text === '') return new Map();
  const scripts = JSON.parse(text).scripts ?? {};
  return new Map(Object.entries(scripts));
}

/**
 * Findings for a package.json: a changed or removed script. An added script and a dependency
 * change pass (rush add edits the dependencies).
 */
export function scriptFindings(beforeText, afterText) {
  const after = scriptsOf(afterText);
  const findings = [];
  for (const [name, command] of scriptsOf(beforeText)) {
    if (!after.has(name)) {
      findings.push({
        line: FIRST_LINE,
        message: `package.json script "${name}" removed; needs ${RISK_HIGH_LABEL}`,
      });
    } else if (after.get(name) !== command) {
      findings.push({
        line: FIRST_LINE,
        message: `package.json script "${name}" changed; needs ${RISK_HIGH_LABEL}`,
      });
    }
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
