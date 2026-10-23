// Test location: finds unit test files that are outside a `test/` folder. Vitest runs only the
// files that match its `include` glob (`test/**`), so a test in another place would never run and
// nobody would see it. The check fails on such a file and names the path to use.
//
// A test file is `*.test.{ts,tsx,js,jsx,mjs,cjs,mts,cts}` or `*.spec.{ts,tsx}`. These stay allowed:
//   - any file under a `test/` folder (this covers `scripts/gates/test/**` and `tooling/tsconfig/test/**`),
//   - Playwright specs in `projects/<name>/web/e2e/**`,
//   - Python (`tests/`, `test_*.py`) and Go (`*_test.go`) tests. They have other names and are not matched.

const UNIT_TEST_FILE = /\.test\.[cm]?[jt]sx?$/;
const SPEC_FILE = /\.spec\.tsx?$/;
const E2E_SPEC = /^projects\/[^/]+\/web\/e2e\/.+\.spec\.tsx?$/;
const TEST_FOLDER = 'test';

/**
 * Tells whether a path is a TypeScript or JavaScript test file by its name.
 *
 * @param {string} file - Repo path with forward slashes.
 * @returns {boolean} True for `*.test.*` and `*.spec.*` files.
 */
export function isUnitTestName(file) {
  return UNIT_TEST_FILE.test(file) || SPEC_FILE.test(file);
}

/**
 * Tells whether a test file is in an allowed place.
 *
 * @param {string} file - Repo path with forward slashes.
 * @returns {boolean} True when the file has a `test/` folder in its path, or is a Playwright spec.
 */
export function isAllowedTestPlace(file) {
  const folders = file.split('/').slice(0, -1);
  return folders.includes(TEST_FOLDER) || E2E_SPEC.test(file);
}

/**
 * Builds the path where a misplaced test belongs. The `test/` folder is at the root of the Rush
 * project and mirrors the source path.
 *
 * @param {string} file - Repo path of the misplaced test.
 * @returns {string} The target path.
 */
export function suggestTestPath(file) {
  /** @type {[RegExp, string][]} */
  const rules = [
    [/^(projects\/[^/]+)\/src\/(contracts|api)\/(.+)$/, '$1/test/$2/$3'],
    [/^(projects\/[^/]+)\/web\/(.+)$/, '$1/test/web/$2'],
    [/^(projects\/[^/]+)\/lib\/(.+)$/, '$1/test/infra/$2'],
    [/^(projects\/[^/]+)\/bin\/(.+)$/, '$1/test/infra/bin/$2'],
    [/^(platform\/infra)\/lib\/(.+)$/, '$1/test/$2'],
    [/^(platform\/infra)\/bin\/(.+)$/, '$1/test/bin/$2'],
    [/^((?:packages|tooling)\/[^/]+)\/src\/(.+)$/, '$1/test/$2'],
  ];
  for (const [pattern, replacement] of rules) {
    if (pattern.test(file)) {
      return file.replace(pattern, replacement);
    }
  }
  return `test/${file}`;
}

/**
 * @typedef {object} Misplaced
 * @property {string} file - Repo path of the test file.
 * @property {string} target - Where the file belongs.
 */

/**
 * Finds the test files that are outside a `test/` folder.
 *
 * @param {readonly string[]} files - Repo paths with forward slashes.
 * @returns {Misplaced[]} The misplaced files, in the input order.
 */
export function findMisplacedTests(files) {
  return files
    .filter((file) => isUnitTestName(file) && !isAllowedTestPlace(file))
    .map((file) => ({ file, target: suggestTestPath(file) }));
}

const MAX_LISTED = 8;

/**
 * Judges the misplaced files.
 *
 * @param {readonly Misplaced[]} misplaced - The misplaced files.
 * @returns {{ status: 'pass' | 'fail', summary: string }} The result. A misplaced test has no label to allow it.
 */
export function judgeTestLocation(misplaced) {
  if (misplaced.length === 0) {
    return { status: 'pass', summary: 'every test file is in a test/ folder' };
  }
  const listed = misplaced
    .slice(0, MAX_LISTED)
    .map((entry) => `${entry.file} (move to ${entry.target})`)
    .join(', ');
  const more =
    misplaced.length > MAX_LISTED ? `, and ${String(misplaced.length - MAX_LISTED)} more` : '';
  return {
    status: 'fail',
    summary: `${String(misplaced.length)} test file${misplaced.length === 1 ? ' is' : 's are'} outside a test/ folder, so Vitest does not run ${misplaced.length === 1 ? 'it' : 'them'}: ${listed}${more}`,
  };
}
