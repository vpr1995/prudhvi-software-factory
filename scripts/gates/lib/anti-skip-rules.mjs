// Pattern tables for the anti-skip scanner. Each pattern is a rule an agent must not break to
// make a check pass. The scanner skips scripts/gates/** (see gate-files.json), so these
// sources do not flag themselves.

/** @typedef {'js' | 'py' | 'go' | 'bru' | 'config' | 'other'} Language */

/**
 * @typedef {object} LineRule
 * @property {string} id - Rule id.
 * @property {Language[]} languages - Languages the rule applies to.
 * @property {RegExp} pattern - Match on an added line.
 * @property {string} message - What is wrong.
 * @property {boolean} [maskStrings] - Ignore text inside string literals.
 * @property {RegExp} [files] - Apply only to repo paths that match.
 * @property {boolean} [testFilesOnly] - Apply only to test files.
 * @property {boolean} [receiverCheck] - Flag only a call on a test function or on a test alias.
 */

const JS_EXTENSIONS = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts']);
const CONFIG_EXTENSIONS = new Set([
  'json',
  'jsonc',
  'yml',
  'yaml',
  'toml',
  'sh',
  'bash',
  'mk',
  'cfg',
  'ini',
]);

/**
 * Picks the language of a file from its name.
 *
 * @param {string} path - Repo path.
 * @returns {Language} The language.
 */
export function languageOf(path) {
  const name = path.split('/').pop() ?? '';
  const extension = name.includes('.') ? (name.split('.').pop() ?? '') : '';
  if (JS_EXTENSIONS.has(extension)) {
    return 'js';
  }
  if (extension === 'py' || extension === 'pyi') {
    return 'py';
  }
  if (extension === 'go') {
    return 'go';
  }
  if (extension === 'bru') {
    return 'bru';
  }
  return CONFIG_EXTENSIONS.has(extension) || name === 'Makefile' ? 'config' : 'other';
}

/** @type {readonly LineRule[]} */
export const LINE_RULES = [
  {
    id: 'test-skip-or-focus',
    maskStrings: true,
    languages: ['js'],
    pattern:
      /\b(?:it|test|describe|suite|context|bench|specify|base|baseTest|spec|scenario|feature)\s*\.\s*(?:(?:describe|concurrent|serial|parallel)\s*\.\s*|)(?:(?:describe|concurrent|serial|parallel)\s*\.\s*|)(?:(?:describe|concurrent|serial|parallel)\s*\.\s*|)(?:skip|only|todo|fails|fixme|fail|skipIf|runIf)\b/,
    message:
      'adds a skipped, focused, todo or conditional test (.skip, .only, .todo, .fixme, .fail, .fails, .skipIf, .runIf)',
  },
  {
    id: 'test-skip-any-receiver',
    maskStrings: true,
    languages: ['js'],
    testFilesOnly: true,
    receiverCheck: true,
    pattern: /\.\s*(?:skip|only|fixme|skipIf|runIf)\s*\(/,
    message:
      'adds a skip, only, fixme, skipIf or runIf call on an alias of the test function in a test file',
  },
  {
    id: 'test-skip-computed',
    languages: ['js'],
    pattern: /\b(?:it|test|describe|suite)\s*\[\s*['"`](?:skip|only|todo|fixme|fail|skipIf|runIf)/,
    message: 'adds a skip or focus through a computed property (it["skip"])',
  },
  {
    id: 'test-x-prefix',
    maskStrings: true,
    languages: ['js'],
    pattern: /\b(?:xit|xtest|xdescribe|xspecify|fit|fdescribe)\s*(?:\.\s*each\b[^(]*|)\(/,
    message: 'adds xit, xdescribe, xtest, fit or fdescribe',
  },
  {
    id: 'test-tautology',
    maskStrings: false,
    languages: ['js'],
    testFilesOnly: true,
    pattern:
      /\bexpect\(\s*(?:true|false|null|undefined|\d+|'[^']*'|"[^"]*")\s*\)\s*\.\s*(?:toBe|toEqual|toStrictEqual|toBeTruthy|toBeFalsy|toBeNull|toBeUndefined|toBeDefined)\b|\bassert(?:\.ok)?\(\s*true\s*\)|\bassert\.(?:equal|strictEqual)\(\s*(\d+|true)\s*,\s*\1\s*\)/,
    message: 'adds an assertion that cannot fail (expect(true).toBe(true) and similar)',
  },
  {
    id: 'eslint-disable',
    maskStrings: true,
    languages: ['js'],
    pattern: /eslint-disable/,
    message: 'adds an eslint-disable comment',
  },
  {
    id: 'ts-directive',
    maskStrings: true,
    languages: ['js'],
    pattern: /@ts-(?:ignore|expect-error|nocheck)\b/,
    message: 'adds @ts-ignore, @ts-expect-error or @ts-nocheck',
  },
  {
    id: 'as-any',
    maskStrings: true,
    languages: ['js'],
    pattern: /\bas\s+any\b/,
    message: 'adds a cast to any',
  },
  {
    id: 'as-unknown-as',
    maskStrings: true,
    languages: ['js'],
    pattern: /\bas\s+unknown\s+as\b/,
    message: 'adds a double cast (as unknown as)',
  },
  {
    id: 'coverage-ignore',
    languages: ['js'],
    pattern: /\b(?:istanbul|c8|v8)\s+ignore\b/,
    message: 'adds a coverage ignore comment',
  },
  {
    id: 'security-suppress',
    languages: ['js', 'py', 'go', 'config', 'bru'],
    pattern: /\b(?:nosemgrep|nosec|gitleaks:allow|checkov:skip|nosonar|opengrep-ignore)\b/i,
    message:
      'adds a comment that hides a security finding (nosemgrep, nosec, gitleaks:allow, checkov:skip)',
  },
  {
    id: 'pass-with-no-tests',
    languages: ['js', 'py', 'config'],
    pattern: /passWithNoTests|pass-with-no-tests/,
    message: 'adds passWithNoTests, which lets a project with no tests pass',
  },
  {
    id: 'or-true',
    languages: ['config'],
    pattern: /\|\|\s*true\b/,
    message: 'adds "|| true" to a script, which hides a failing command',
  },
  {
    id: 'empty-catch',
    languages: ['js'],
    pattern: /\bcatch\s*\{\s*\}|\bcatch\s*\([^)]*\)\s*\{\s*\}/,
    message: 'adds an empty catch block',
  },
  {
    id: 'py-test-skip',
    languages: ['py'],
    pattern:
      /\bpytest\.mark\.\w*(?:skip|xfail)\w*|\bmark\.(?:skip|skipif|xfail)\b|\bpytest\.(?:skip|xfail|importorskip)\s*\(|\bunittest\.(?:skip|skipIf|skipUnless|expectedFailure|SkipTest)\b|\bskipTest\s*\(|^\s*@(?:skip|skipIf|skipUnless|expectedFailure)\b|\braise\s+(?:unittest\.)?SkipTest\b|\b__test__\s*=\s*False\b|\bxfail_strict\s*=\s*(?:false|0)/i,
    message:
      'adds a pytest skip, skipif, xfail, importorskip, skipTest, a unittest skip or __test__ = False',
  },
  {
    id: 'py-collection-hook',
    languages: ['py', 'config'],
    files: /(?:conftest\.py|pytest\.ini|pyproject\.toml|setup\.cfg|tox\.ini)$/,
    pattern:
      /\bcollect_ignore(?:_glob)?\b|\bpytest_collection_modifyitems\b|\bpytest_ignore_collect\b|\bpytest_runtest_setup\b|\bpytest_pyfunc_call\b|\bpytest_configure\b.*\b(?:skip|ignore)|--(?:ignore|ignore-glob|deselect)\b|\bnorecursedirs\b|\bpython_files\s*=/,
    message:
      'adds a pytest hook or option that can drop tests (collect_ignore, pytest_collection_modifyitems, --ignore, --deselect, norecursedirs, python_files)',
  },
  {
    id: 'py-empty-parametrize',
    languages: ['py'],
    pattern: /\bparametrize\([^)]*,\s*\[\s*\]\s*[,)]/,
    message: 'adds a parametrize with an empty list, which skips the test',
  },
  {
    id: 'py-noqa',
    languages: ['py'],
    pattern: /#\s*noqa\b|#\s*ruff:\s*noqa\b/i,
    message: 'adds a noqa comment',
  },
  {
    id: 'py-type-ignore',
    languages: ['py'],
    pattern: /#\s*type:\s*ignore|#\s*(?:pyright|mypy):\s*(?:ignore|basic)/i,
    message: 'adds a type ignore comment',
  },
  {
    id: 'py-pragma-no-cover',
    languages: ['py'],
    pattern: /#\s*pragma:\s*no\s*cover/i,
    message: 'adds a pragma no cover comment',
  },
  {
    id: 'py-pylint-disable',
    languages: ['py'],
    pattern: /#\s*pylint:\s*disable/i,
    message: 'adds a pylint disable comment',
  },
  {
    id: 'py-empty-except',
    languages: ['py'],
    pattern: /\bexcept\b[^:]*:\s*pass\b/,
    message: 'adds an except block that only passes',
  },
  {
    id: 'go-test-skip',
    languages: ['go'],
    files: /_test\.go$/,
    pattern: /\.\s*Skip(?:f|Now)?\s*\(|\btesting\.Short\s*\(\s*\)/,
    message: 'adds a Skip, Skipf or SkipNow call (any receiver) or a testing.Short() switch',
  },
  {
    id: 'go-build-ignore',
    languages: ['go'],
    pattern: /^\s*\/\/\s*(?:go:build|\+build)\b.*\bignore\b/,
    message: 'adds a build constraint "ignore", which removes the file from the build and tests',
  },
  {
    id: 'go-tautology',
    languages: ['go'],
    testFilesOnly: true,
    pattern: /\bif\s+false\s*\{|\bassert\.True\(\s*\w+\s*,\s*true\s*\)/,
    message: 'adds a Go check that cannot fail',
  },
  {
    id: 'go-nolint',
    languages: ['go'],
    pattern: /\/\/\s*nolint\b/,
    message: 'adds a nolint comment',
  },
  {
    id: 'go-empty-error-branch',
    languages: ['go'],
    pattern: /\bif\s+err\s*!=\s*nil\s*\{\s*\}/,
    message: 'adds an empty error branch',
  },
  {
    id: 'bru-skip-request',
    languages: ['bru'],
    pattern: /skipRequest|skip-request|stopExecution|setNextRequest\s*\(/,
    message:
      'adds a skipRequest, stopExecution or setNextRequest call in a Bruno request (it can end the run early)',
  },
  {
    id: 'bru-tautology',
    languages: ['bru'],
    pattern:
      /\bexpect\(\s*(?:true|1|false|'[^']*'|"[^"]*")\s*\)\.(?:to|be)\b|\bres\.status\s*:\s*(?:neq|gte)\s+(?:0|100)\b/,
    message: 'adds a Bruno check that cannot fail',
  },
  {
    id: 'shell-exit-zero',
    languages: ['config'],
    files: /\.(?:sh|bash|mk|ya?ml)$|(?:^|\/)Makefile$|(?:^|\/)package\.json$/,
    pattern:
      /\|\|\s*exit\s+0\b|;\s*exit\s+0\b|&&\s*exit\s+0\b|\|\|\s*:\s*(?:$|[;&)"'|])|\|\|\s*\/bin\/true\b|continue-on-error\s*:\s*true\b/,
    message:
      'adds a shell construct that hides a failing command ("|| exit 0", "|| :", continue-on-error)',
  },
  {
    // `set +e` is normal in many scripts. It hides a failure only where a gate runs: the git hooks,
    // the check scripts, and the `_phase:*` commands in package.json.
    id: 'shell-exit-zero',
    languages: ['config', 'other'],
    files:
      /(?:^|\/)common\/git-hooks\/|(?:^|\/)scripts\/(?:test|lint|security|check-coverage|license-check|check)\.sh$/,
    pattern: /\bset\s+\+e\b/,
    message: 'adds "set +e" to a git hook or a check script, which hides a failing command',
  },
  {
    id: 'shell-exit-zero',
    languages: ['config'],
    files: /(?:^|\/)package\.json$/,
    pattern: /"_phase:[^"]*"\s*:\s*"[^"]*\bset\s+\+e\b/,
    message: 'adds "set +e" to a _phase script, which hides a failing command',
  },
  {
    id: 'weaken-flag',
    languages: ['config'],
    files: /(?:^|\/)package\.json$|\.(?:sh|bash|mk|ya?ml)$|(?:^|\/)Makefile$/,
    pattern:
      /--coverage\.(?:enabled|thresholds?|exclude|include|all|skipFull)\b|--coverage(?:=|\s+)false\b|--no-coverage\b|--max-warnings(?:=|\s+)(?!0\b)\S+|--exit-zero\b|--no-error-on-unmatched-pattern\b|--testPathIgnorePatterns\b|--coveragePathIgnorePatterns\b|--(?:deselect|ignore)(?:=|\s+)\S*test|\s-k\s+["']?not\b|--allowOnly\b|--silent-fail\b|--no-fail\b/,
    message:
      'adds a flag that weakens a check (--coverage.*, --no-coverage, --max-warnings above 0, --exit-zero, --deselect, -k "not ...")',
  },
];

/** Opening line and closing line of a block that must not be empty (checked on added lines). */
export const EMPTY_BLOCK_RULES = [
  {
    id: 'empty-catch',
    languages: ['js'],
    open: /\bcatch\s*\{\s*$|\bcatch\s*\([^)]*\)\s*\{\s*$/,
    close: /^\s*\}/,
    message: 'adds an empty catch block',
  },
  {
    id: 'py-empty-except',
    languages: ['py'],
    open: /^\s*except\b[^:]*:\s*$/,
    close: /^\s*pass\s*$/,
    message: 'adds an except block that only passes',
  },
  {
    id: 'go-empty-error-branch',
    languages: ['go'],
    open: /\bif\s+err\s*!=\s*nil\s*\{\s*$/,
    close: /^\s*\}/,
    message: 'adds an empty error branch',
  },
  {
    id: 'empty-test-body',
    languages: ['js'],
    open: /\b(?:it|test|specify)(?:\.\w+|)(?:\.\w+|)(?:\.\w+|)\s*\(.*(?:=>|\bfunction\b[^{]*)\s*\{\s*$/,
    close: /^\s*\}\s*\)/,
    message: 'adds a test with an empty body',
  },
  {
    id: 'empty-test-body',
    languages: ['py'],
    open: /^\s*(?:async\s+|)def\s+test_\w*\([^)]*\)\s*(?:->[^:]*|):\s*$/,
    close: /^\s*(?:pass|\.\.\.|return)\s*$/,
    message: 'adds a test with an empty body',
  },
  {
    id: 'empty-test-body',
    languages: ['go'],
    open: /^\s*func\s+Test\w*\([^)]*\)\s*\{\s*$/,
    close: /^\s*\}/,
    message: 'adds a test with an empty body',
  },
];

/** One-line empty test bodies and tests without a callback (js, py, go). */
export const EMPTY_TEST_LINE_RULES = [
  {
    id: 'empty-test-body',
    languages: ['js'],
    pattern:
      /\b(?:it|test|specify)(?:\.\w+|)(?:\.\w+|)(?:\.\w+|)\s*\(\s*(?:'[^']*'|"[^"]*"|`[^`]*`)\s*,\s*(?:async\s+|)function\b[^{]*\{\s*\}\s*[,)]/,
    message: 'adds a test with an empty body',
  },
  {
    id: 'empty-test-body',
    languages: ['js'],
    pattern:
      /\b(?:it|test|specify)(?:\.\w+|)(?:\.\w+|)(?:\.\w+|)\s*\(\s*(?:'[^']*'|"[^"]*"|`[^`]*`)\s*,\s*(?:async\s+|)(?:\([^)]*\)|\w+)\s*=>\s*\{\s*\}\s*[,)]/,
    message: 'adds a test with an empty body',
  },
  {
    id: 'empty-test-body',
    languages: ['js'],
    pattern:
      /^\s*(?:it|test|specify)(?:\.\w+|)(?:\.\w+|)(?:\.\w+|)\s*\(\s*(?:'[^']*'|"[^"]*"|`[^`]*`)\s*\)\s*;?\s*$/,
    message: 'adds a test with no callback (it is a todo)',
  },
  {
    id: 'empty-test-body',
    languages: ['py'],
    pattern: /^\s*(?:async\s+|)def\s+test_\w*\([^)]*\)\s*(?:->[^:]*|):\s*(?:pass|\.\.\.)\s*$/,
    message: 'adds a test with an empty body',
  },
  {
    id: 'empty-test-body',
    languages: ['go'],
    pattern: /^\s*func\s+Test\w*\([^)]*\)\s*\{\s*\}/,
    message: 'adds a test with an empty body',
  },
];

const TEST_FILE_PATTERNS = [
  /\.(?:test|spec)\.[cm]?[jt]sx?$/,
  /(?:^|\/)__tests__\/.+\.[cm]?[jt]sx?$/,
  /(?:^|\/)test_[^/]*\.py$/,
  /_test\.py$/,
  /_test\.go$/,
  /(?:^|\/)bruno\/.+\.bru$/,
];
const BRUNO_NON_REQUEST = /(?:^|\/)(?:collection|folder)\.bru$|\/environments\//;

/**
 * Tells whether a path is a test file.
 *
 * @param {string} path - Repo path.
 * @returns {boolean} True for unit, e2e, Python, Go and Bruno test files.
 */
export function isTestFile(path) {
  return TEST_FILE_PATTERNS.some((pattern) => pattern.test(path)) && !BRUNO_NON_REQUEST.test(path);
}

const NON_CASE_MEMBERS = new Set([
  'describe',
  'step',
  'use',
  'beforeEach',
  'afterEach',
  'beforeAll',
  'afterAll',
  'setTimeout',
  'extend',
  'configure',
  'slow',
  'info',
  'expect',
]);

/**
 * Counts test cases that a JS or TS line starts (`it(`, `test(`, `it.each(...)(`).
 *
 * @param {string} text - A source line.
 * @returns {number} 1 or 0.
 */
function jsTestCases(text) {
  const trimmed = text.trimStart();
  const line = trimmed.startsWith('await ') ? trimmed.slice('await '.length).trimStart() : trimmed;
  let head = '';
  if (line.startsWith('it')) {
    head = 'it';
  } else if (line.startsWith('test')) {
    head = 'test';
  }
  const rest = line.slice(head.length);
  const member = /^\.(\w+)/.exec(rest)?.[1] ?? '';
  const afterMember = member === '' ? rest : rest.slice(member.length + 1);
  const opensCall = /^\s*[(`]/.test(afterMember);
  return head !== '' && opensCall && !NON_CASE_MEMBERS.has(member) ? 1 : 0;
}

/**
 * Counts how many test cases a line starts.
 *
 * @param {string} text - A source line.
 * @param {Language} language - File language.
 * @returns {number} The count (0, 1 or 2).
 */
export function testCasesInLine(text, language) {
  if (language === 'js') {
    return jsTestCases(text);
  }
  if (language === 'py') {
    const trimmed = text.trimStart();
    const line = trimmed.startsWith('async ') ? trimmed.slice('async '.length) : trimmed;
    return /^def\s+test_\w*\(/.test(line) ? 1 : 0;
  }
  if (language === 'go') {
    return (/^func\s+Test\w*\(/.test(text) ? 1 : 0) + (/\bt\.Run\(/.test(text) ? 1 : 0);
  }
  return 0;
}
