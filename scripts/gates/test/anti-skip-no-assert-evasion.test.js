// The test-without-assertion rule of the anti-skip scanner: words that do not assert must not
// count as an assertion (review finding). Each FLAGGED case is an evasion. Each ALLOWED case is a
// real assertion that must still count.
import assert from 'node:assert/strict';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { exec, GATES, makeRepository } from './harness.js';

const CLI = path.join(GATES, 'anti-skip.mjs');
const RULE = '[test-without-assertion]';

describe('anti-skip test-without-assertion evasions', () => {
  let repository;

  beforeEach(() => {
    repository = makeRepository();
  });
  afterEach(() => repository.remove());

  const scan = () => exec('node', [CLI, '--root', repository.root, '--base', 'HEAD']);
  const allowed = (file, content) => {
    repository.write(file, content);
    const result = scan();
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  };
  const flagged = (file, content, message = 'has a changed test that holds no assertion') => {
    repository.write(file, content);
    const result = scan();
    assert.equal(result.status, 1, `${result.stdout}${result.stderr}`);
    assert.ok(result.stderr.includes(RULE), result.stderr);
    assert.ok(result.stderr.includes(message), result.stderr);
  };

  describe('JavaScript', () => {
    for (const [label, body] of [
      ["require('fs') only", "const fs = require('fs');\n  fs.readFileSync('a');"],
      ['require("fs") only', 'require("node:fs");'],
      ['validate() only', 'validate(input);'],
      ['bare verify() and ensure() only', 'verify(input);\n  ensure(input);'],
      ['a method call .validateSync() only', 'schema.validateSync(input);'],
      ['a Playwright check() action only', "await page.locator('#a').check();"],
    ]) {
      it(`flags a test with ${label}`, () => {
        flagged('packages/a/src/a.test.ts', `it('x', async () => {\n  ${body}\n});\n`);
      });
    }

    for (const [label, body] of [
      ['expect()', 'expect(run()).toBe(2);'],
      ['assert.equal', 'assert.equal(run(), 2);'],
      ['a check helper', 'checkResult(run());'],
      ['a verify helper', 'await verifyHealth(app);'],
      ['validate and ensure helpers', 'validateSchema(run());\n  ensureStatus(run(), 2);'],
    ]) {
      it(`allows a test with ${label}`, () => {
        allowed('packages/a/src/a.test.ts', `it('x', () => {\n  ${body}\n});\n`);
      });
    }
  });

  describe('Python', () => {
    it('flags a test with validate() only', () => {
      flagged('packages/a/tests/test_a.py', 'def test_a():\n    validate(payload)\n');
    });

    it('flags a test that only reads a validate attribute', () => {
      flagged('packages/a/tests/test_a.py', 'def test_a():\n    model.validate\n');
    });

    it('flags a test with bare verify() and ensure() only', () => {
      flagged(
        'packages/a/tests/test_a.py',
        'def test_a():\n    verify(payload)\n    ensure(payload)\n',
      );
    });

    it('flags a test with a method call .validate_json() only', () => {
      flagged('packages/a/tests/test_a.py', 'def test_a():\n    model.validate_json(payload)\n');
    });

    it('allows a test with a verify helper', () => {
      allowed('packages/a/tests/test_a.py', 'def test_a():\n    verify_health(app)\n');
    });

    it('allows a test with assert', () => {
      allowed('packages/a/tests/test_a.py', 'def test_a():\n    assert run() == 2\n');
    });
  });

  describe('Go', () => {
    it('flags a t.Run subtest with no assertion in its closure', () => {
      flagged(
        'packages/a/a_test.go',
        'func TestA(t *testing.T) {\n\tt.Run("x", func(t *testing.T) {\n\t\t_ = run()\n\t})\n}\n',
      );
    });

    it('flags an empty t.Run closure next to a subtest that asserts', () => {
      flagged(
        'packages/a/a_test.go',
        [
          'func TestA(t *testing.T) {',
          '\tt.Run("x", func(t *testing.T) {',
          '\t\t_ = run()',
          '\t})',
          '\tt.Run("y", func(t *testing.T) {',
          '\t\tt.Error("y")',
          '\t})',
          '}',
          '',
        ].join('\n'),
        'has a changed t.Run subtest whose closure holds no assertion',
      );
    });

    it('allows a t.Run subtest with t.Fatal in its closure', () => {
      allowed(
        'packages/a/a_test.go',
        [
          'func TestA(t *testing.T) {',
          '\tt.Run("x", func(t *testing.T) {',
          '\t\tif run() != 2 {',
          '\t\t\tt.Fatal("bad")',
          '\t\t}',
          '\t})',
          '}',
          '',
        ].join('\n'),
      );
    });

    it('allows a helper call that passes t', () => {
      allowed('packages/a/a_test.go', 'func TestA(t *testing.T) {\n\tcompare(t, run(), 2)\n}\n');
    });
  });
});
