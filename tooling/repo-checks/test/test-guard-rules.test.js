// Tests for the parsers and rules of scripts/test-guard.mjs.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseNameStatus, parsePatch } from '../scripts/lib/test-guard-diff.mjs';
import {
  countTestCases,
  isCheckConfig,
  isExempt,
  isTestFile,
  parseLabels,
  scriptFindings,
  skipFindings,
  suppressionFindings,
  thresholdFindings,
} from '../scripts/lib/test-guard-rules.mjs';

const lines = (...texts) => texts.map((text, index) => ({ line: index + 1, text }));

test('parseNameStatus reads renames with two paths', () => {
  const text = 'M\0a.ts\0R097\0old.test.ts\0new.test.ts\0D\0gone.ts\0';
  assert.deepEqual(parseNameStatus(text), [
    { status: 'M', oldPath: 'a.ts', path: 'a.ts' },
    { status: 'R', oldPath: 'old.test.ts', path: 'new.test.ts' },
    { status: 'D', oldPath: 'gone.ts', path: 'gone.ts' },
  ]);
});

test('parsePatch reads added and removed lines with line numbers', () => {
  const patch = [
    'diff --git a/src/a.ts b/src/a.ts',
    'index 1..2 100644',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -3 +3,2 @@',
    '-old',
    '+new',
    '+++ added line that looks like a header',
    'diff --git a/gone.ts b/gone.ts',
    '--- a/gone.ts',
    '+++ /dev/null',
    '@@ -1,2 +0,0 @@',
    '-x',
    '-y',
    '',
  ].join('\n');
  const files = parsePatch(patch);
  assert.deepEqual(files.get('src/a.ts'), {
    added: [
      { line: 3, text: 'new' },
      { line: 4, text: '++ added line that looks like a header' },
    ],
    removed: [{ line: 3, text: 'old' }],
  });
  assert.deepEqual(files.get('gone.ts').removed.length, 2);
});

test('isTestFile knows unit tests, specs and Bruno requests', () => {
  assert.ok(isTestFile('packages/a/test/x.test.ts'));
  assert.ok(isTestFile('projects/s/test/web/page.test.tsx'));
  assert.ok(isTestFile('projects/s/e2e/home.spec.ts'));
  assert.ok(isTestFile('tooling/x/test/a.test.mjs'));
  assert.ok(isTestFile('projects/s/bruno/notes/create-note.bru'));
  assert.ok(!isTestFile('projects/s/bruno/environments/local.bru'));
  assert.ok(!isTestFile('projects/s/bruno/collection.bru'));
  assert.ok(!isTestFile('projects/s/src/testing.ts'));
});

test('isExempt skips Markdown, fixtures and the guard package', () => {
  assert.ok(isExempt('docs/a.md'));
  assert.ok(isExempt('packages/a/test/fixtures/x.ts'));
  assert.ok(isExempt('tooling/repo-checks/scripts/test-guard.mjs'));
  assert.ok(!isExempt('packages/a/test/x.test.ts'));
});

test('isCheckConfig flags changed config, not an added project config', () => {
  assert.ok(isCheckConfig('projects/s/vitest.config.ts', 'M'));
  assert.ok(isCheckConfig('projects/s/eslint.config.js', 'D'));
  assert.ok(!isCheckConfig('projects/new/vitest.config.ts', 'A'));
  assert.ok(!isCheckConfig('projects/new/playwright.config.ts', 'A'));
  assert.ok(isCheckConfig('knip.jsonc', 'M'));
  assert.ok(isCheckConfig('audit-ci.jsonc', 'A'));
  assert.ok(isCheckConfig('tooling/tsconfig/base.json', 'M'));
  assert.ok(isCheckConfig('tooling/eslint-config/src/configs/base.js', 'A'));
  assert.ok(isCheckConfig('tooling/repo-checks/scripts/test-guard.mjs', 'M'));
  assert.ok(isCheckConfig('.github/workflows/ci.yml', 'M'));
  assert.ok(isCheckConfig('.github/actions/repo-setup/action.yml', 'A'));
  assert.ok(!isCheckConfig('.github/ISSUE_TEMPLATE/bug.yml', 'M'));
  assert.ok(!isCheckConfig('tooling/eslint-config/README.md', 'M'));
  assert.ok(!isCheckConfig('tooling/tsconfig/scripts/check-tsconfigs.mjs', 'M'));
  assert.ok(!isCheckConfig('projects/s/src/config.ts', 'M'));
});

test('countTestCases counts it, test and each, not comments or other calls', () => {
  const text = [
    "it('a', () => {});",
    "test('b', () => {});",
    'it.each([1, 2])("c %s", () => {});',
    'test.each`a`("d", () => {});',
    "// it('commented', () => {});",
    "/* test('block', () => {}); */",
    'submit(form); xit("x"); foo.it("y");',
    "describe('group', () => {});",
  ].join('\n');
  assert.equal(countTestCases(text), 4);
});

test('skipFindings flags skipped, focused and todo tests on added lines', () => {
  const added = lines(
    "it.only('a', () => {});",
    "describe.skip('b', () => {});",
    "test.todo('c');",
    "test.describe.only('d', () => {});",
    "xit('e', () => {});",
    "xdescribe('f', () => {});",
    "// it.only('comment')",
    "it('fine', () => {});",
  );
  assert.deepEqual(
    skipFindings(added).map((finding) => finding.line),
    [1, 2, 3, 4, 5, 6],
  );
});

test('suppressionFindings flags lint and TypeScript ignore comments', () => {
  const added = lines(
    '// eslint-disable-next-line no-console',
    '/* eslint-disable */',
    '// @ts-ignore',
    '// @ts-expect-error: reason',
    '// @ts-nocheck',
    'const ok = 1;',
  );
  assert.deepEqual(
    suppressionFindings(added).map((finding) => `${finding.line} ${finding.message}`),
    [
      '1 added an eslint-disable comment',
      '2 added an eslint-disable comment',
      '3 added a @ts-ignore comment',
      '4 added a @ts-expect-error comment',
      '5 added a @ts-nocheck comment',
    ],
  );
});

test('thresholdFindings flags a lowered or removed coverage threshold', () => {
  const removed = lines('  lines: 80,', '  branches: 75,');
  const added = [{ line: 6, text: '  lines: 70,' }];
  assert.deepEqual(thresholdFindings({ added, removed }), [
    { line: 6, message: 'threshold lines lowered from 80 to 70' },
    { line: 1, message: 'threshold branches (75) removed' },
  ]);
});

test('thresholdFindings passes a raised threshold', () => {
  const removed = lines('  lines: 80,');
  const added = lines('  lines: 85,');
  assert.deepEqual(thresholdFindings({ added, removed }), []);
});

test('thresholdFindings flags a changed threshold constant that is not a number', () => {
  const removed = lines('export const DIFF_COVERAGE_THRESHOLD = COVERAGE_THRESHOLDS.lines;');
  const lowered = lines('export const DIFF_COVERAGE_THRESHOLD = 50;');
  assert.deepEqual(thresholdFindings({ added: lowered, removed }), [
    {
      line: 1,
      message: 'threshold DIFF_COVERAGE_THRESHOLD changed from COVERAGE_THRESHOLDS.lines to 50',
    },
  ]);
  assert.deepEqual(thresholdFindings({ added: removed, removed }), []);
});

test('parseLabels reads a JSON array and fails on bad input', () => {
  assert.deepEqual(parseLabels(), []);
  assert.deepEqual(parseLabels(''), []);
  assert.deepEqual(parseLabels('["risk:high","x"]'), ['risk:high', 'x']);
  assert.throws(() => parseLabels('risk:high'));
  assert.throws(() => parseLabels('{"a":1}'));
});

test('parsePatch strips the tab that git adds after a path with a space', () => {
  const patch = [
    'diff --git a/my dir/code.ts b/my dir/code.ts',
    '--- a/my dir/code.ts\t',
    '+++ b/my dir/code.ts\t',
    '@@ -0,0 +1 @@',
    '+x',
    '',
  ].join('\n');
  assert.deepEqual([...parsePatch(patch).keys()], ['my dir/code.ts']);
});

test('isCheckConfig flags project tsconfig changes, Rush commands and GitHub controls', () => {
  assert.ok(isCheckConfig('projects/s/tsconfig.json', 'M'));
  assert.ok(isCheckConfig('projects/s/web/tsconfig.json', 'D'));
  assert.ok(isCheckConfig('packages/a/tsconfig.build.json', 'M'));
  assert.ok(!isCheckConfig('projects/new/tsconfig.json', 'A'));
  assert.ok(isCheckConfig('common/config/rush/command-line.json', 'M'));
  assert.ok(isCheckConfig('.github/zizmor.yml', 'M'));
  assert.ok(isCheckConfig('.github/CODEOWNERS', 'M'));
  assert.ok(!isCheckConfig('.github/pull_request_template.md', 'M'));
});

test('scriptFindings flags a changed or removed script, not an added script or a dependency', () => {
  const before = JSON.stringify({
    scripts: { test: 'vitest run', lint: 'eslint .' },
    dependencies: { a: '1.0.0' },
  });
  const changed = JSON.stringify({
    scripts: { test: 'vitest run --passWithNoTests', build: 'tsc' },
    dependencies: { a: '2.0.0', b: '1.0.0' },
  });
  assert.deepEqual(
    scriptFindings(before, changed).map((finding) => finding.message),
    [
      'package.json script "test" changed; needs risk:high',
      'package.json script "lint" removed; needs risk:high',
    ],
  );
  const added = JSON.stringify({
    scripts: { test: 'vitest run', lint: 'eslint .', e2e: 'x' },
    dependencies: { c: '1.0.0' },
  });
  assert.deepEqual(scriptFindings(before, added), []);
  assert.deepEqual(scriptFindings('', added), []);
});

test('countTestCases does not treat globs in strings as a block comment', () => {
  const text = [
    "const a = 'packages/*/src';",
    "it('a', () => {});",
    "const b = '**/*.ts';",
    "test('b', () => {});",
  ].join('\n');
  assert.equal(countTestCases(text), 2);
});

test('countTestCases counts concurrent, sequential, fails, for, skipIf and runIf forms', () => {
  const text = [
    "it.concurrent('a', () => {});",
    "test.concurrent.each([1])('b', () => {});",
    "it.sequential('c', () => {});",
    "it.fails('d', () => {});",
    "it.for([1])('e', () => {});",
    "it.skipIf(process.env.CI)('f', () => {});",
    "test.runIf(isLinux())('g', () => {});",
    "test.describe('group', () => {});",
    "test.step('step', async () => {});",
  ].join('\n');
  assert.equal(countTestCases(text), 7);
});

test('skipFindings flags skipIf and skips behind concurrent or sequential, not runIf', () => {
  const added = lines(
    "it.skipIf(process.env.CI)('a', () => {});",
    "it.concurrent.skip('b', () => {});",
    "describe.sequential.only('c', () => {});",
    "test.concurrent.todo('d');",
    "it.runIf(isLinux())('e', () => {});",
    'RuleTester.itOnly = it.only;',
  );
  assert.deepEqual(
    skipFindings(added).map((finding) => finding.line),
    [1, 2, 3, 4],
  );
});

test('suppressionFindings ignores a suppression line that only moved', () => {
  const added = lines('  // eslint-disable-next-line no-console', '// @ts-ignore');
  const removed = lines('// eslint-disable-next-line no-console');
  assert.deepEqual(
    suppressionFindings(added, removed).map((finding) => finding.line),
    [2],
  );
});
