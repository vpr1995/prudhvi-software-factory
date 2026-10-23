// Tests for the test-location check of check-gates.mjs (lib/test-location.mjs). The CLI runs for
// real against temp git repos.
import assert from 'node:assert/strict';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  findMisplacedTests,
  isAllowedTestPlace,
  isUnitTestName,
  judgeTestLocation,
  suggestTestPath,
} from '../lib/test-location.mjs';

import { exec, GATES, makeRepository } from './harness.js';

const CLI = path.join(GATES, 'check-gates.mjs');

describe('test-location helpers', () => {
  it('recognizes unit test names', () => {
    for (const file of [
      'a.test.ts',
      'a.test.tsx',
      'a.test.js',
      'a.test.jsx',
      'a.test.mjs',
      'a.test.cjs',
      'a.test.mts',
      'a/b.spec.ts',
      'a/b.spec.tsx',
    ]) {
      assert.equal(isUnitTestName(file), true, file);
    }
    for (const file of [
      'a.ts',
      'test.ts',
      'a.test.py',
      'a_test.go',
      'tests/test_a.py',
      'a.tests.ts',
    ]) {
      assert.equal(isUnitTestName(file), false, file);
    }
  });

  it('allows a test under a test folder at any depth', () => {
    for (const file of [
      'packages/a/test/a.test.ts',
      'projects/p/test/web/app/page.test.tsx',
      'scripts/gates/test/check-gates.test.js',
      'tooling/tsconfig/test/node.test.js',
      'platform/infra/test/bin/app.test.ts',
    ]) {
      assert.equal(isAllowedTestPlace(file), true, file);
    }
  });

  it('allows a Playwright spec in web/e2e only', () => {
    assert.equal(isAllowedTestPlace('projects/p/web/e2e/home.spec.ts'), true);
    assert.equal(isAllowedTestPlace('projects/p/web/e2e/nested/a.spec.ts'), true);
    assert.equal(isAllowedTestPlace('projects/p/web/e2e/a.test.ts'), false);
    assert.equal(isAllowedTestPlace('projects/p/web/app/a.spec.ts'), false);
    assert.equal(isAllowedTestPlace('packages/a/src/e2e/a.spec.ts'), false);
  });

  it('does not accept a file that only has "test" in a folder name', () => {
    assert.equal(isAllowedTestPlace('packages/a/src/testing/a.test.ts'), false);
    assert.equal(isAllowedTestPlace('packages/a/src/tests/a.test.ts'), false);
    assert.equal(isAllowedTestPlace('packages/a/src/test-utils/a.test.ts'), false);
  });

  it('names the target path with the mirror rule', () => {
    const cases = {
      'packages/result/src/result.test.ts': 'packages/result/test/result.test.ts',
      'tooling/eslint-config/src/rules/a.test.js': 'tooling/eslint-config/test/rules/a.test.js',
      'platform/infra/lib/stack.test.ts': 'platform/infra/test/stack.test.ts',
      'platform/infra/lib/config/config.test.ts': 'platform/infra/test/config/config.test.ts',
      'platform/infra/bin/app.test.ts': 'platform/infra/test/bin/app.test.ts',
      'projects/p/src/contracts/x.test.ts': 'projects/p/test/contracts/x.test.ts',
      'projects/p/src/api/routes/x.test.ts': 'projects/p/test/api/routes/x.test.ts',
      'projects/p/web/components/x.test.tsx': 'projects/p/test/web/components/x.test.tsx',
      'projects/p/lib/stack.test.ts': 'projects/p/test/infra/stack.test.ts',
      'projects/p/bin/app.test.ts': 'projects/p/test/infra/bin/app.test.ts',
      'src/x.test.ts': 'test/src/x.test.ts',
    };
    for (const [file, target] of Object.entries(cases)) {
      assert.equal(suggestTestPath(file), target, file);
    }
  });

  it('finds the misplaced files and keeps the allowed ones', () => {
    const found = findMisplacedTests([
      'src/x.test.ts',
      'web/e2e/a.spec.ts',
      'projects/p/web/e2e/a.spec.ts',
      'lib/x.test.ts',
      'packages/a/test/a.test.ts',
      'projects/p/src/api-py/tests/test_a.py',
      'projects/p/src/api-go/internal/a_test.go',
      'packages/a/src/a.ts',
    ]);
    assert.deepEqual(
      found.map((entry) => entry.file),
      ['src/x.test.ts', 'web/e2e/a.spec.ts', 'lib/x.test.ts'],
    );
  });

  it('judges the result', () => {
    assert.equal(judgeTestLocation([]).status, 'pass');
    const one = judgeTestLocation([
      { file: 'packages/a/src/a.test.ts', target: 'packages/a/test/a.test.ts' },
    ]);
    assert.equal(one.status, 'fail');
    assert.match(
      one.summary,
      /packages\/a\/src\/a\.test\.ts \(move to packages\/a\/test\/a\.test\.ts\)/,
    );
    const many = judgeTestLocation(
      Array.from({ length: 10 }, (_, index) => ({
        file: `s/${String(index)}.test.ts`,
        target: 't',
      })),
    );
    assert.match(many.summary, /10 test files are outside/);
    assert.match(many.summary, /, and 2 more$/);
  });
});

describe('check-gates test-location', () => {
  let repository;

  beforeEach(() => {
    repository = makeRepository({ 'packages/a/test/a.test.ts': "import { it } from 'vitest';\n" });
    repository.git('checkout', '-q', '-b', 'feature');
  });
  afterEach(() => repository.remove());

  const commit = () => {
    repository.git('add', '-A');
    repository.git('commit', '-q', '-m', 'change');
  };
  const run = () => {
    const result = exec('node', [
      CLI,
      '--root',
      repository.root,
      '--base',
      'main',
      '--head',
      'feature',
      '--json',
    ]);
    const report = JSON.parse(result.stdout);
    return { result, check: report.checks.find((entry) => entry.name === 'test-location') };
  };

  it('passes when every test is in a test folder', () => {
    repository.write('packages/a/test/b.test.ts', 'x\n');
    commit();
    const { result, check } = run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(check.status, 'pass');
  });

  it('fails on a test next to the source and names the target', () => {
    repository.write('packages/a/src/x.test.ts', 'x\n');
    commit();
    const { result, check } = run();
    assert.equal(result.status, 1);
    assert.equal(check.status, 'fail');
    assert.deepEqual(check.details.misplaced, [
      { file: 'packages/a/src/x.test.ts', target: 'packages/a/test/x.test.ts' },
    ]);
    assert.match(check.summary, /move to packages\/a\/test\/x\.test\.ts/);
  });

  it('fails on a test in lib and on a test in an unknown root folder', () => {
    repository.write('projects/p/lib/x.test.ts', 'x\n');
    repository.write('src/x.test.ts', 'x\n');
    commit();
    const { result, check } = run();
    assert.equal(result.status, 1);
    assert.deepEqual(
      check.details.misplaced.map((entry) => entry.file),
      ['projects/p/lib/x.test.ts', 'src/x.test.ts'],
    );
  });

  it('fails on a misplaced test that the base already has', () => {
    repository.git('checkout', '-q', 'main');
    repository.write('packages/a/src/old.test.ts', 'x\n');
    repository.git('add', '-A');
    repository.git('commit', '-q', '-m', 'old');
    repository.git('checkout', '-q', 'feature');
    repository.git('merge', '-q', 'main');
    const { result, check } = run();
    assert.equal(result.status, 1);
    assert.equal(check.status, 'fail');
  });

  it('allows a Playwright spec in web/e2e and fails on a spec elsewhere', () => {
    repository.write('projects/p/web/e2e/a.spec.ts', 'x\n');
    commit();
    assert.equal(run().check.status, 'pass');
    repository.write('web/e2e/b.spec.ts', 'x\n');
    commit();
    const { check } = run();
    assert.equal(check.status, 'fail');
    assert.deepEqual(
      check.details.misplaced.map((entry) => entry.file),
      ['web/e2e/b.spec.ts'],
    );
  });

  it('does not check Python and Go tests', () => {
    repository.write('projects/p/src/api-py/tests/test_a.py', 'def test_a():\n    pass\n');
    repository.write('projects/p/src/api-go/internal/a_test.go', 'package a\n');
    commit();
    assert.equal(run().check.status, 'pass');
  });
});
