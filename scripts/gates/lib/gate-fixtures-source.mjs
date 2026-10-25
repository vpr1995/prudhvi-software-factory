// Gate fixtures for bad source code: ESLint, Opengrep, anti-skip and a failing test. Each bad
// snippet is built with `join`, so no scanner reads a bad pattern in this file.
import {
  accepts,
  gateScript,
  join,
  lintFixture,
  opengrepRun,
  rejects,
  vitestRun,
  write,
} from './gate-fixtures-kit.mjs';

const SAMPLE = 'projects/sample';
const DOMAIN = 'src/api/domain';
const TEST_DIR = 'test/api/domain';
const ANY = join('an', 'y');
const SKIP = join('it.', 'skip');
const ONLY = join('it.', 'only');
const DISABLE = join('eslint-', 'disable');
const TS_IGNORE = join('@ts-', 'ignore');
const EVAL_ROW = `\`eval(userInput)\` / \`${join('dangerously', 'SetInnerHTML')}\` with input`;
const CLEAN_TEST = (name) =>
  `import { expect, it } from 'vitest';\n\nit('${name}', () => {\n  expect(1 + 1).toBe(2);\n});\n`;

/** ESLint rows of plan section 11. Every rule id was seen in a real run before it went in here. */
export const LINT_FIXTURES = [
  lintFixture({
    id: 'lint-any',
    row: 'Add `any`',
    change: 'a function with an `any` parameter and result',
    file: `${DOMAIN}/fixture-any.ts`,
    text: `/** Returns the value. */\nexport function identity(value: ${ANY}): ${ANY} {\n  return value;\n}\n`,
    match: [/@typescript-eslint\/no-explicit-any/],
  }),
  lintFixture({
    id: 'lint-test-only',
    row: 'Add `it.only` / `it.skip`',
    change: 'a focused test (`it.only`)',
    file: `${TEST_DIR}/fixture-only.test.ts`,
    text: `import { expect, it } from 'vitest';\n\n${ONLY}('adds', () => {\n  expect(1 + 1).toBe(2);\n});\n`,
    match: [/vitest\/no-focused-tests/],
  }),
  lintFixture({
    id: 'lint-test-skip',
    row: 'Add `it.only` / `it.skip`',
    change: 'a skipped test (`it.skip`)',
    file: `${TEST_DIR}/fixture-skip.test.ts`,
    text: `import { expect, it } from 'vitest';\n\n${SKIP}('adds', () => {\n  expect(1 + 1).toBe(2);\n});\n`,
    match: [/vitest\/no-disabled-tests/],
  }),
  lintFixture({
    id: 'lint-disable-no-description',
    row: `Add \`// ${DISABLE}\` without description`,
    change: 'an eslint disable comment with no description',
    file: `${DOMAIN}/fixture-disable.ts`,
    text: `${join('// eslint-', 'disable-next-line no-console')}\nexport const VALUE = 1;\n`,
    match: [/eslint-comments\/require-description/],
  }),
  lintFixture({
    id: 'lint-ts-ignore',
    row: `Add \`${TS_IGNORE}\``,
    change: 'a ts-ignore comment',
    file: `${DOMAIN}/fixture-ts-ignore.ts`,
    text: `${join('// @ts-', 'ignore')}\nexport const VALUE: number = 'text';\n`,
    match: [/@typescript-eslint\/ban-ts-comment/],
  }),
  lintFixture({
    id: 'lint-process-env-in-route',
    row: '`process.env.X` in a route file',
    change: 'a read of the environment in a route file',
    file: 'src/api/routes/notes/fixture-env.ts',
    text: `export const VALUE = ${join('process', '.env')}['FOO'];\n`,
    match: [/no-restricted-syntax/, /Read `process\.env` only in/],
  }),
  lintFixture({
    id: 'lint-enum',
    row: '`enum Status {}` / `export default` in a non-Next file',
    change: 'a TypeScript enum',
    file: `${DOMAIN}/fixture-enum.ts`,
    text: `export ${join('en', 'um')} Status {\n  Open,\n  Closed,\n}\n`,
    match: [/Do not use TypeScript enums/],
  }),
  lintFixture({
    id: 'lint-default-export',
    row: '`enum Status {}` / `export default` in a non-Next file',
    change: 'a default export',
    file: `${DOMAIN}/fixture-default.ts`,
    text: `const VALUE = 1;\n${join('export def', 'ault')} VALUE;\n`,
    match: [/import-x\/no-default-export/],
  }),
  lintFixture({
    id: 'lint-todo-without-link',
    row: '`TODO` without an issue link',
    change: 'a work marker with no issue number',
    file: `${DOMAIN}/fixture-todo.ts`,
    text: `${join('// TO', 'DO')} fix this later\nexport const VALUE = 1;\n`,
    match: [/local\/todo-with-issue/],
  }),
  lintFixture({
    id: 'lint-naming-variable',
    row: 'Variable `user_name`, type `IUser`, file `UserService.ts`',
    change: 'a snake_case variable',
    file: `${DOMAIN}/fixture-naming-variable.ts`,
    text: "export const user_name = 'a';\n",
    match: [/@typescript-eslint\/naming-convention/, /user_name/],
  }),
  lintFixture({
    id: 'lint-naming-type',
    row: 'Variable `user_name`, type `IUser`, file `UserService.ts`',
    change: 'a type named `IUser`',
    file: `${DOMAIN}/fixture-naming-type.ts`,
    text: 'export type IUser = { name: string };\n',
    match: [/@typescript-eslint\/naming-convention/, /IUser/],
  }),
  lintFixture({
    id: 'lint-naming-filename',
    row: 'Variable `user_name`, type `IUser`, file `UserService.ts`',
    change: 'a PascalCase file name (`UserService.ts`)',
    file: `${DOMAIN}/UserService.ts`,
    text: 'export const VALUE = 1;\n',
    match: [/unicorn\/filename-case/],
  }),
  lintFixture({
    id: 'lint-web-imports-api',
    row: 'Import `api` from `web` in one project',
    change: 'a web file that imports the API server',
    file: 'web/lib/fixture-boundary.ts',
    text: "import { buildServer } from '../../src/api/server.js';\n\nexport const SERVER = buildServer;\n",
    match: [/boundaries\/dependencies/],
  }),
  lintFixture({
    id: 'lint-eval',
    row: EVAL_ROW,
    change: 'a call of `eval` with the input',
    file: `${DOMAIN}/fixture-eval.ts`,
    text: `/** Runs the text. */\nexport function run(input: string): unknown {\n  return ${join('ev', 'al')}(input);\n}\n`,
    match: [/no-eval/],
  }),
  lintFixture({
    id: 'lint-dangerous-html',
    row: EVAL_ROW,
    change: 'a component that sets raw HTML from a prop',
    file: 'web/components/fixture-html.tsx',
    text: `export function Html({ html }: { html: string }) {\n  return <div ${join('dangerously', 'SetInnerHTML')}={{ __html: html }} />;\n}\n`,
    match: [/react\/no-danger/],
  }),
  {
    ...lintFixture({
      id: 'lint-control',
      row: 'Control',
      change: 'a clean source file',
      file: `${DOMAIN}/fixture-clean.ts`,
      text: '/** The one value. */\nexport const VALUE = 1;\n',
      match: [],
    }),
    control: true,
    expected: undefined,
  },
];

/**
 * An Opengrep fixture.
 *
 * @param {{ id: string, row: string, change: string, file: string, text: string, rule: RegExp }} spec - The fixture.
 * @returns {import('./gate-fixtures-run.mjs').Fixture} The fixture.
 */
function opengrepFixture(spec) {
  const path = `${SAMPLE}/${spec.file}`;
  return {
    id: spec.id,
    row: spec.row,
    change: spec.change,
    gate: 'Opengrep (tooling/opengrep)',
    setup: [write(path, spec.text)],
    run: opengrepRun([path]),
    expected: rejects([spec.rule, spec.file]),
  };
}

/** Opengrep rows. A missing `opengrep` binary is a FAIL, as in the pre-push hook of CI. */
export const OPENGREP_FIXTURES = [
  opengrepFixture({
    id: 'opengrep-eval',
    row: EVAL_ROW,
    change: 'a call of `eval` with the input',
    file: `${DOMAIN}/fixture-og-eval.ts`,
    text: `export function run(input: string): unknown {\n  return ${join('ev', 'al')}(input);\n}\n`,
    rule: /no-eval-or-function-constructor/,
  }),
  opengrepFixture({
    id: 'opengrep-dangerous-html',
    row: EVAL_ROW,
    change: 'a component that sets raw HTML from a prop',
    file: 'web/components/fixture-og-html.tsx',
    text: `export function Html({ html }: { html: string }) {\n  return <div ${join('dangerously', 'SetInnerHTML')}={{ __html: html }} />;\n}\n`,
    rule: /no-dangerously-set-inner-html/,
  }),
  opengrepFixture({
    id: 'opengrep-sql-string',
    row: 'SQL string built from request input',
    change: 'a query text joined with a request value',
    file: 'src/api/adapters/fixture-og-sql.ts',
    text: `export function find(db: { query: (text: string) => unknown }, id: string): unknown {\n  return db.query('select * from users where id = ' + id);\n}\n`,
    rule: /no-sql-string-concatenation/,
  }),
  {
    ...opengrepFixture({
      id: 'opengrep-control',
      row: 'Control',
      change: 'a query with a parameter',
      file: 'src/api/adapters/fixture-og-clean.ts',
      text: `export function find(db: { query: (text: string, values: string[]) => unknown }, id: string): unknown {\n  return db.query('select * from users where id = $1', [id]);\n}\n`,
      rule: /unused/,
    }),
    control: true,
    expected: undefined,
  },
];

/**
 * An anti-skip fixture: the working tree against HEAD.
 *
 * @param {{ id: string, row: string, change: string, setup: Record<string, unknown>[], rule: RegExp, control?: boolean }} spec - The fixture.
 * @returns {import('./gate-fixtures-run.mjs').Fixture} The fixture.
 */
function antiSkipFixture(spec) {
  return {
    id: spec.id,
    row: spec.row,
    change: spec.change,
    gate: 'anti-skip scan (Stop hook, pre-commit, step d)',
    setup: spec.setup,
    run: gateScript('anti-skip.mjs', ['--root', '{worktree}', '--base', 'HEAD']),
    expected: rejects([spec.rule], 1),
    ...(spec.control === true ? { control: true } : {}),
  };
}

const SKIP_TEST = `import { expect, it } from 'vitest';\n\n${SKIP}('adds', () => {\n  expect(1 + 1).toBe(2);\n});\n`;
// The body holds a `require(...)` call and a plain call only. Before the tightened rule of agent C,
// the scan took `require(` as an assertion, so this test passed the scan.
const NO_ASSERTION_TEST = `import { it } from 'vitest';\n\nconst run = (): number => 1 + 1;\n\nit('computes', () => {\n  const fs = require('fs');\n  run();\n});\n`;
const ANTI_SKIP_PASS = /anti-skip: pass \([1-9]\d* changed files scanned\)/;
const LOWER_COVERAGE = [
  {
    type: 'replace',
    path: 'tooling/vitest-config/src/config.ts',
    find: 'lines: 80,',
    text: 'lines: 60,',
  },
];

export const ANTI_SKIP_FIXTURES = [
  antiSkipFixture({
    id: 'anti-skip-test-skip',
    row: 'Add `it.only` / `it.skip`',
    change: 'a new test with `it.skip`',
    setup: [write(`${SAMPLE}/${TEST_DIR}/fixture-skip.test.ts`, SKIP_TEST)],
    rule: /\[test-skip-or-focus\]/,
  }),
  antiSkipFixture({
    id: 'stop-it-skip',
    row: 'Stop after adding `it.skip` to make tests pass',
    change: 'a new `it.skip` (the Stop hook runs this scan on the session diff)',
    setup: [write(`${SAMPLE}/${TEST_DIR}/fixture-stop-skip.test.ts`, SKIP_TEST)],
    rule: /\[test-skip-or-focus\]/,
  }),
  antiSkipFixture({
    id: 'stop-lower-threshold',
    row: 'Stop after lowering a coverage threshold',
    change: 'the line coverage threshold goes from 80 to 60 (the Stop hook runs this scan)',
    setup: LOWER_COVERAGE,
    rule: /\[coverage-lowered\]/,
  }),
  {
    ...antiSkipFixture({
      id: 'anti-skip-no-assertion',
      row: 'New rule: a new test with no assertion (agent C)',
      change: 'a new test whose body is only a `require` call and a plain call (it checks nothing)',
      setup: [write(`${SAMPLE}/${TEST_DIR}/fixture-no-assert.test.ts`, NO_ASSERTION_TEST)],
      rule: /\[test-without-assertion\]/,
    }),
    needs: 'C',
  },
  {
    ...antiSkipFixture({
      id: 'anti-skip-control',
      row: 'Control',
      change: 'a new test with an assertion',
      setup: [write(`${SAMPLE}/${TEST_DIR}/fixture-clean.test.ts`, CLEAN_TEST('adds'))],
      rule: /unused/,
      control: true,
    }),
    // The scan must pass AND read the new file: a count of 0 files is not a pass of this control.
    expected: accepts([ANTI_SKIP_PASS]),
  },
];

const FAILING_TEST = `import { expect, it } from 'vitest';\n\nit('fails', () => {\n  expect(1 + 1).toBe(3);\n});\n`;
const FAILING_FILE = `${TEST_DIR}/fixture-failing.test.ts`;

/** The Stop hook runs `rush verify`. A fixture cannot run Rush, so it runs the same test with Vitest. */
export const TEST_FIXTURES = [
  {
    id: 'stop-failing-test',
    row: 'Stop with a failing test',
    change:
      'a new test that fails (Vitest on the file: the Stop hook runs Rush, which a fixture does not)',
    gate: 'Vitest (the test phase of verify and the Stop hook)',
    setup: [write(`${SAMPLE}/${FAILING_FILE}`, FAILING_TEST)],
    run: vitestRun([FAILING_FILE]),
    expected: rejects([/AssertionError|expected 2 to be 3/, /fixture-failing\.test\.ts/]),
  },
  {
    id: 'test-control',
    row: 'Control',
    change: 'a new test that passes',
    gate: 'Vitest (the test phase of verify and the Stop hook)',
    setup: [write(`${SAMPLE}/${TEST_DIR}/fixture-passing.test.ts`, CLEAN_TEST('adds'))],
    run: vitestRun([`${TEST_DIR}/fixture-passing.test.ts`]),
    control: true,
  },
];
