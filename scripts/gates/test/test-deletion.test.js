// Tests for the test-deletion check of check-gates.mjs (lib/test-deletion.mjs). The CLI runs for
// real against temp git repos.
import assert from 'node:assert/strict';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { judgeRemovals, TEST_REMOVAL_LABEL } from '../lib/test-deletion.mjs';

import { exec, GATES, makeRepository } from './harness.js';

const CLI = path.join(GATES, 'check-gates.mjs');

/** A TypeScript test file with a number of cases, three lines for each case. */
const tsTests = (count, prefix = 'case') =>
  `import { it } from 'vitest';\n${Array.from(
    { length: count },
    (_, index) =>
      `it('${prefix} ${String(index)}', () => {\n  expect(run(${String(index)})).toBe(${String(index)});\n});\n`,
  ).join('')}`;
const pyTests = (count) =>
  Array.from(
    { length: count },
    (_, index) =>
      `def test_${String(index)}():\n    assert run(${String(index)}) == ${String(index)}\n`,
  ).join('\n');
const goTests = (count) =>
  `package a\n\n${Array.from({ length: count }, (_, index) => `func Test${String(index)}(t *testing.T) {\n\tif run(${String(index)}) != ${String(index)} {\n\t\tt.Fatal("x")\n\t}\n}\n`).join('\n')}`;
const BRU_WITH_ASSERT =
  'meta {\n  name: A\n}\n\nget {\n  url: {{baseUrl}}/v1/a\n}\n\nassert {\n  res.status: eq 200\n}\n';
const BRU_WITH_TESTS =
  'meta {\n  name: B\n}\n\nget {\n  url: {{baseUrl}}/v1/b\n}\n\ntests {\n  test("ok", function () {\n    expect(res.status).to.equal(200);\n  });\n}\n';
const BRU_PLAIN = 'meta {\n  name: C\n}\n\nget {\n  url: {{baseUrl}}/v1/c\n}\n';

describe('test-deletion helpers', () => {
  it('judges the removals', () => {
    const removal = { file: 'a.test.ts', line: 1, kind: 'deleted', detail: 'test file deleted' };
    assert.equal(judgeRemovals([], []).status, 'pass');
    assert.equal(judgeRemovals([removal], []).status, 'fail');
    assert.equal(judgeRemovals([removal], [TEST_REMOVAL_LABEL]).status, 'warn');
    assert.equal(judgeRemovals([removal], ['lint-exception']).status, 'fail');
  });
});

describe('check-gates test-deletion', () => {
  let repository;

  beforeEach(() => {
    repository = makeRepository({
      'packages/a/src/a.test.ts': tsTests(6),
      'packages/a/src/b.test.ts': tsTests(6, 'other'),
      'packages/a/src/a.ts': 'export const a = 1;\n',
      'packages/a/e2e/home.spec.ts': tsTests(3, 'home'),
      'packages/a/src/view.test.tsx': tsTests(3, 'view'),
      'projects/p/src/api-py/tests/test_a.py': pyTests(4),
      'projects/p/src/api-py/tests/b_test.py': pyTests(4),
      'projects/p/src/api-go/a_test.go': goTests(4),
      'projects/p/bruno/notes/with-assert.bru': BRU_WITH_ASSERT,
      'projects/p/bruno/notes/with-tests.bru': BRU_WITH_TESTS,
      'projects/p/bruno/notes/plain.bru': BRU_PLAIN,
      'projects/p/bruno/collection.bru': 'auth {\n  mode: none\n}\n',
      'projects/p/bruno/environments/local.bru': 'vars {\n  baseUrl: http://localhost\n}\n',
      'docs/guide.md': 'text\n',
    });
    repository.git('checkout', '-q', '-b', 'feature');
  });
  afterEach(() => repository.remove());

  const commit = (message = 'change') => {
    repository.git('add', '-A');
    repository.git('commit', '-q', '-m', message);
  };
  const move = (from, to) => {
    exec('mkdir', ['-p', path.dirname(path.join(repository.root, to))]);
    repository.git('mv', from, to);
  };
  const check = (args = []) => {
    const result = exec('node', [
      CLI,
      '--root',
      repository.root,
      '--base',
      'main',
      '--head',
      'feature',
      '--json',
      ...args,
    ]);
    const report = JSON.parse(result.stdout);
    return { result, check: report.checks.find((entry) => entry.name === 'test-deletion') };
  };

  describe('deleted files', () => {
    const deleted = [
      'packages/a/src/a.test.ts',
      'packages/a/e2e/home.spec.ts',
      'packages/a/src/view.test.tsx',
      'projects/p/src/api-py/tests/test_a.py',
      'projects/p/src/api-py/tests/b_test.py',
      'projects/p/src/api-go/a_test.go',
      'projects/p/bruno/notes/with-assert.bru',
      'projects/p/bruno/notes/with-tests.bru',
    ];
    for (const file of deleted) {
      it(`fails when ${file} is deleted`, () => {
        repository.git('rm', '-q', file);
        commit();
        const { result, check: found } = check();
        assert.equal(result.status, 1, result.stderr);
        assert.equal(found.status, 'fail');
        assert.deepEqual(found.details.removals, [
          { file, line: 1, kind: 'deleted', detail: 'test file deleted' },
        ]);
        assert.ok(
          found.summary.includes(`${path.basename(file)}:1 (test file deleted)`),
          found.summary,
        );
      });
    }

    it('allows the deletion with the test-removal label and exits 0', () => {
      repository.git('rm', '-q', 'packages/a/src/a.test.ts');
      commit();
      const { result, check: found } = check(['--labels', `risk:low, ${TEST_REMOVAL_LABEL}`]);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(found.status, 'warn');
      assert.match(found.summary, /Allowed by the "test-removal" label/);
    });

    it('does not accept another label in place of test-removal', () => {
      repository.git('rm', '-q', 'packages/a/src/a.test.ts');
      commit();
      assert.equal(check(['--labels', 'lint-exception,large-pr']).result.status, 1);
    });

    it('reports every deleted file', () => {
      repository.git('rm', '-q', 'packages/a/src/a.test.ts', 'packages/a/src/b.test.ts');
      commit();
      const { check: found } = check();
      assert.deepEqual(
        found.details.removals.map((entry) => entry.file),
        ['packages/a/src/a.test.ts', 'packages/a/src/b.test.ts'],
      );
      assert.match(found.summary, /^2 removals: /);
    });

    it('does not count a deleted file that is not a test', () => {
      repository.git('rm', '-q', 'packages/a/src/a.ts', 'docs/guide.md');
      commit();
      assert.equal(check().result.status, 0);
    });

    it('does not count a deleted Bruno request with no assert and no tests block, a collection file or an environment', () => {
      repository.git(
        'rm',
        '-q',
        'projects/p/bruno/notes/plain.bru',
        'projects/p/bruno/collection.bru',
        'projects/p/bruno/environments/local.bru',
      );
      commit();
      const { result, check: found } = check();
      assert.equal(result.status, 0, result.stderr);
      assert.equal(found.status, 'pass');
    });
  });

  describe('renames', () => {
    it('treats a rename with no change as a move', () => {
      move('packages/a/src/a.test.ts', 'packages/a/lib/a.test.ts');
      commit();
      const { result, check: found } = check();
      assert.equal(result.status, 0, result.stderr);
      assert.equal(found.status, 'pass');
      assert.deepEqual(found.details.moves, [
        { from: 'packages/a/src/a.test.ts', to: 'packages/a/lib/a.test.ts' },
      ]);
      assert.match(found.summary, /1 test file moved with no loss/);
    });

    it('treats a move of a Bruno request, a Python test and a Go test as moves', () => {
      move('projects/p/bruno/notes/with-assert.bru', 'projects/p/bruno/notes/moved.bru');
      move('projects/p/src/api-py/tests/test_a.py', 'projects/p/src/api-py/tests/test_moved.py');
      move('projects/p/src/api-go/a_test.go', 'projects/p/src/api-go/moved_test.go');
      commit();
      const { result, check: found } = check();
      assert.equal(result.status, 0, result.stderr);
      assert.equal(found.details.moves.length, 3);
    });

    it('passes when a moved file has more cases', () => {
      move('packages/a/src/a.test.ts', 'packages/a/lib/a.test.ts');
      repository.write('packages/a/lib/a.test.ts', tsTests(7));
      commit();
      const { result, check: found } = check();
      assert.equal(result.status, 0, result.stderr);
      assert.equal(found.status, 'pass');
    });

    it('passes when a moved file has the same cases with new titles', () => {
      move('packages/a/src/a.test.ts', 'packages/a/lib/a.test.ts');
      repository.write('packages/a/lib/a.test.ts', tsTests(6).replaceAll('case', 'renamed case'));
      commit();
      assert.equal(check().result.status, 0);
    });

    it('fails when a moved file has fewer cases', () => {
      move('packages/a/src/a.test.ts', 'packages/a/lib/a.test.ts');
      repository.write('packages/a/lib/a.test.ts', tsTests(5));
      commit();
      const { result, check: found } = check();
      assert.equal(result.status, 1, result.stderr);
      assert.equal(found.details.removals.length, 1);
      assert.equal(found.details.removals[0].kind, 'fewer-cases');
      assert.equal(found.details.removals[0].file, 'packages/a/src/a.test.ts');
      assert.match(found.summary, /fewer test cases \(1 removed, 0 added\)/);
    });

    it('fails when a test file is renamed to a path that is not a test', () => {
      move('packages/a/src/a.test.ts', 'packages/a/src/a-notes.txt');
      commit();
      const { result, check: found } = check();
      assert.equal(result.status, 1, result.stderr);
      assert.deepEqual(found.details.removals, [
        {
          file: 'packages/a/src/a.test.ts',
          line: 1,
          kind: 'moved-out',
          detail: 'moved to packages/a/src/a-notes.txt, which is not a test path',
        },
      ]);
    });

    it('does not count a file that is renamed into a test file', () => {
      move('packages/a/src/a.ts', 'packages/a/src/c.test.ts');
      commit();
      assert.equal(check().result.status, 0);
    });
  });

  describe('modified files', () => {
    it('fails when a test file has fewer cases', () => {
      repository.write('packages/a/src/a.test.ts', tsTests(4));
      commit();
      const { result, check: found } = check();
      assert.equal(result.status, 1, result.stderr);
      assert.equal(found.details.removals[0].kind, 'fewer-cases');
      assert.match(
        found.summary,
        /packages\/a\/src\/a\.test\.ts:\d+ \(fewer test cases \(2 removed, 0 added\)\)/,
      );
    });

    it('fails when a Python or Go test case is removed', () => {
      repository.write('projects/p/src/api-py/tests/test_a.py', pyTests(3));
      repository.write('projects/p/src/api-go/a_test.go', goTests(3));
      commit();
      const { check: found } = check();
      assert.deepEqual(
        found.details.removals.map((entry) => entry.file),
        ['projects/p/src/api-go/a_test.go', 'projects/p/src/api-py/tests/test_a.py'],
      );
    });

    it('reports the old line of the first removed case', () => {
      repository.write(
        'packages/a/src/a.test.ts',
        tsTests(6).replace("it('case 2'", "// moved\nconst skipped = ('case 2'"),
      );
      commit();
      const { check: found } = check();
      assert.equal(found.details.removals[0].line, 8);
    });

    it('passes when the cases change but the count does not drop', () => {
      repository.write('packages/a/src/a.test.ts', tsTests(6).replaceAll('case', 'new'));
      repository.write('packages/a/src/b.test.ts', tsTests(8, 'other'));
      commit();
      const { result, check: found } = check();
      assert.equal(result.status, 0, result.stderr);
      assert.equal(found.status, 'pass');
      assert.equal(found.summary, 'no test removed');
    });

    it('does not count a case that moves to another place in the same file', () => {
      const text = tsTests(6);
      const [head, ...cases] = text.split("it('");
      repository.write('packages/a/src/a.test.ts', [head, ...cases.reverse()].join("it('"));
      commit();
      assert.equal(check().result.status, 0);
    });

    it('does not count a new test file or a change to a file that is not a test', () => {
      repository.write('packages/a/src/new.test.ts', tsTests(2));
      repository.write('packages/a/src/a.ts', '');
      commit();
      assert.equal(check().result.status, 0);
    });

    it('does not count removals that only the base branch made', () => {
      repository.write('packages/a/src/new.ts', 'export const n = 1;\n');
      commit();
      repository.git('checkout', '-q', 'main');
      repository.git('rm', '-q', 'packages/a/src/b.test.ts');
      commit('base moves');
      repository.git('checkout', '-q', 'feature');
      const { result, check: found } = check();
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(found.details.removals, []);
    });
  });

  it('prints the check in the human summary', () => {
    repository.git('rm', '-q', 'packages/a/src/a.test.ts');
    commit();
    const result = exec('node', [
      CLI,
      '--root',
      repository.root,
      '--base',
      'main',
      '--head',
      'feature',
    ]);
    assert.equal(result.status, 1);
    assert.match(
      result.stdout,
      /^FAIL test-deletion: 1 removal: packages\/a\/src\/a\.test\.ts:1 \(test file deleted\)/m,
    );
  });
});
