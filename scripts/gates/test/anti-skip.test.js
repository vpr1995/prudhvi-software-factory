import assert from 'node:assert/strict';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { exec, GATES, makeRepository } from './harness.js';

const CLI = path.join(GATES, 'anti-skip.mjs');

// The forbidden words are joined at run time so that this file does not hold them as plain text.
const index = (...parts) => parts.join('');
const TS_SKIP = index('it', '.skip', "('later', () => {});\n");
const TS_ONLY = index('it', '.only', "('only me', () => {});\n");
const TS_DESCRIBE_SKIP = index('describe', '.skip', "('suite', () => {});\n");
const TS_XIT = index('x', 'it', "('later', () => {});\n");
const TS_TODO = index('it', '.todo', "('later');\n");
const PW_FIXME = index('test', '.fixme', "('later', async () => {});\n");
const ESLINT_OFF = index('// eslint', '-disable', '-next-line no-console\n');
const TS_IGNORE = index('// @ts', '-ignore\nconst a = 1;\n');
const TS_EXPECT = index('// @ts', '-expect-error\nconst a = 1;\n');
const AS_ANY = index('const a = b as', ' any;\n');
const EMPTY_CATCH = 'try {\n  run();\n} catch (error) {\n}\n';
const PY_SKIP = index('@pytest.mark', '.skip', '\ndef test_a():\n    pass\n');
const PY_SKIP_CALL = index('def test_a():\n    pytest', '.skip', "('later')\n");
const PY_NOQA = index('import os  # no', 'qa\n');
const PY_IGNORE = index('x: int = "a"  # type', ': ignore\n');
const PY_PRAGMA = index('if x:  # pragma', ': no cover\n    pass\n');
const PY_EMPTY_EXCEPT = 'try:\n    run()\nexcept Exception:\n    pass\n';
const GO_SKIP = index('func TestA(t *testing.T) {\n\tt', '.Skip', '("later")\n}\n');
const GO_NOLINT = index('var x = 1 //', 'nolint', '\n');
const BRU_SKIP = index(
  'get {\n  url: {{baseUrl}}/v1/a\n}\n\nassert {\n  res.status: eq 200\n}\n\nscript:pre-request {\n  bru.runner.',
  'skipRequest',
  '();\n}\n',
);
const BRU_NO_ASSERT = 'meta {\n  name: A\n}\n\nget {\n  url: {{baseUrl}}/v1/a\n}\n';

describe('anti-skip', () => {
  let repository;

  beforeEach(() => {
    repository = makeRepository({
      'packages/a/src/old.test.ts':
        "import { it } from 'vitest';\nit('a', () => { expect(run()).toBe(2); });\nit('b', () => { expect(run()).toBe(2); });\nit('c', () => { expect(run()).toBe(2); });\n",
      'packages/a/vitest.config.ts':
        'export default { test: { coverage: { thresholds: { lines: 80, branches: 70 } } } };\n',
      'tooling/vitest-config/base.js': 'export const thresholds = { lines: 90 };\n',
    });
  });

  afterEach(() => repository.remove());

  const scan = (args = ['--base', 'HEAD']) =>
    exec('node', [CLI, '--root', repository.root, ...args]);

  const rejected = [
    ['a skipped test', 'packages/a/src/a.test.ts', TS_SKIP, 'test-skip-or-focus'],
    ['a focused test', 'packages/a/src/a.test.ts', TS_ONLY, 'test-skip-or-focus'],
    ['a skipped suite', 'packages/a/src/a.test.ts', TS_DESCRIBE_SKIP, 'test-skip-or-focus'],
    ['an x-prefixed test', 'packages/a/src/a.test.ts', TS_XIT, 'test-x-prefix'],
    ['a todo test', 'packages/a/src/a.test.ts', TS_TODO, 'test-skip-or-focus'],
    ['a Playwright fixme', 'projects/p/web/e2e/home.spec.ts', PW_FIXME, 'test-skip-or-focus'],
    ['an eslint-disable comment', 'packages/a/src/a.ts', ESLINT_OFF, 'eslint-disable'],
    ['a ts-ignore comment', 'packages/a/src/a.ts', TS_IGNORE, 'ts-directive'],
    ['a ts-expect-error comment', 'packages/a/src/a.ts', TS_EXPECT, 'ts-directive'],
    ['an as-any cast', 'packages/a/src/a.ts', AS_ANY, 'as-any'],
    ['an empty catch block', 'packages/a/src/a.ts', EMPTY_CATCH, 'empty-catch'],
    ['a Python skip marker', 'projects/p/src/api-py/tests/test_a.py', PY_SKIP, 'py-test-skip'],
    ['a Python skip call', 'projects/p/src/api-py/tests/test_a.py', PY_SKIP_CALL, 'py-test-skip'],
    ['a noqa comment', 'projects/p/src/api-py/src/a.py', PY_NOQA, 'py-noqa'],
    ['a type ignore comment', 'projects/p/src/api-py/src/a.py', PY_IGNORE, 'py-type-ignore'],
    [
      'a pragma no cover comment',
      'projects/p/src/api-py/src/a.py',
      PY_PRAGMA,
      'py-pragma-no-cover',
    ],
    ['a Python except-pass', 'projects/p/src/api-py/src/a.py', PY_EMPTY_EXCEPT, 'py-empty-except'],
    ['a Go test skip', 'projects/p/src/api-go/a_test.go', GO_SKIP, 'go-test-skip'],
    ['a nolint comment', 'projects/p/src/api-go/a.go', GO_NOLINT, 'go-nolint'],
    ['a Bruno skipped request', 'projects/p/bruno/a/a.bru', BRU_SKIP, 'bru-skip-request'],
    [
      'a Bruno request with no assertion',
      'projects/p/bruno/a/b.bru',
      BRU_NO_ASSERT,
      'bru-no-assertion',
    ],
  ];
  for (const [label, file, content, rule] of rejected) {
    it(`fails on ${label}`, () => {
      repository.write(file, content);
      const result = scan();
      assert.equal(result.status, 1, `${result.stdout}${result.stderr}`);
      const lines = result.stderr.split('\n');
      assert.ok(
        lines.some((line) => line.startsWith(`${file}:`) && line.includes(`[${rule}]`)),
        result.stderr,
      );
    });
  }

  it('fails when a coverage threshold is lowered', () => {
    repository.write(
      'packages/a/vitest.config.ts',
      'export default { test: { coverage: { thresholds: { lines: 60, branches: 70 } } } };\n',
    );
    const result = scan();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /\[coverage-lowered\].*lines/);
  });

  it('fails when a coverage threshold is removed', () => {
    repository.write(
      'packages/a/vitest.config.ts',
      'export default { test: { coverage: { thresholds: { lines: 80 } } } };\n',
    );
    const result = scan();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /\[coverage-lowered\].*branches/);
  });

  it('fails when a coverage threshold is lowered in a coverage-only path (tooling)', () => {
    repository.write('tooling/vitest-config/base.js', 'export const thresholds = { lines: 50 };\n');
    const result = scan();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /\[coverage-lowered\]/);
  });

  it('allows a raised coverage threshold', () => {
    repository.write(
      'packages/a/vitest.config.ts',
      'export default { test: { coverage: { thresholds: { lines: 90, branches: 70 } } } };\n',
    );
    assert.equal(scan().status, 0);
  });

  it('fails when a test file is deleted', () => {
    repository.git('rm', '-q', 'packages/a/src/old.test.ts');
    const result = scan();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /packages\/a\/src\/old\.test\.ts:1: \[test-file-deleted\]/);
  });

  it('fails when a test file has fewer test cases', () => {
    repository.write(
      'packages/a/src/old.test.ts',
      "import { it } from 'vitest';\nit('a', () => { expect(run()).toBe(2); });\n",
    );
    const result = scan();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /\[fewer-test-cases\]/);
  });

  it('allows more test cases', () => {
    repository.write(
      'packages/a/src/old.test.ts',
      "import { it } from 'vitest';\nit('a', () => { expect(run()).toBe(2); });\nit('b', () => { expect(run()).toBe(2); });\nit('c', () => { expect(run()).toBe(2); });\nit('d', () => { expect(run()).toBe(2); });\n",
    );
    assert.equal(scan().status, 0);
  });

  it('allows a normal change, a rewritten test and new tests', () => {
    repository.write('packages/a/src/a.ts', 'export const a = 1;\n');
    repository.write(
      'packages/a/src/new.test.ts',
      "import { it } from 'vitest';\nit('works', () => { expect(run()).toBe(2); });\n",
    );
    const result = scan();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /anti-skip: pass/);
  });

  it('does not flag a forbidden word inside a string or in a Markdown file', () => {
    repository.write(
      'packages/a/src/a.ts',
      `export const text = '${index('it', '.skip')}(x) and ${index('eslint', '-disable')}';\n`,
    );
    repository.write(
      'docs/guide.md',
      `Do not use ${index('it', '.skip')} or ${index('@ts', '-ignore')}.\n`,
    );
    assert.equal(scan().status, 0);
  });

  it('scans a staged diff, a git range and a diff on stdin', () => {
    repository.write('packages/a/src/a.test.ts', TS_SKIP);
    repository.git('add', '-A');
    assert.equal(scan(['--staged']).status, 1);
    repository.git('commit', '-q', '-m', 'bad');
    assert.equal(scan(['--range', 'HEAD~1..HEAD']).status, 1);
    const diff = repository.git('diff', '-U0', 'HEAD~1', 'HEAD');
    const result = exec('node', [CLI, '--root', repository.root, '--stdin'], { input: diff });
    assert.equal(result.status, 1);
  });

  it('prints JSON with --json', () => {
    repository.write('packages/a/src/a.test.ts', TS_SKIP);
    const result = scan(['--base', 'HEAD', '--json']);
    assert.equal(result.status, 1);
    const findings = JSON.parse(result.stdout.slice(0, result.stdout.lastIndexOf(']') + 1));
    assert.equal(findings[0].rule, 'test-skip-or-focus');
  });

  it('shows help and rejects bad arguments', () => {
    const help = exec('node', [CLI, '--help']);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /^anti-skip:/);
    assert.equal(exec('node', [CLI, '--nope']).status, 2);
  });
});
