// Bypass cases for the anti-skip scanner: each one hides a skip, drops a test, or weakens a gate.
import assert from 'node:assert/strict';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { exec, GATES, makeRepository } from './harness.js';

const CLI = path.join(GATES, 'anti-skip.mjs');
// The forbidden words are joined at run time so that this file does not hold them as plain text.
const join = (...parts) => parts.join('');
const SKIP = join('.sk', 'ip');
const ONLY = join('.on', 'ly');

const OLD_TEST = "import { it } from 'vitest';\nit('a', () => {\n  expect(run()).toBe(2);\n});\n";
const PACKAGE_JSON = JSON.stringify(
  {
    name: '@t/a',
    scripts: { '_phase:test': 'vitest run --coverage', '_phase:lint': 'eslint --max-warnings 0 .' },
  },
  null,
  2,
);

describe('anti-skip bypass cases', () => {
  let repository;

  beforeEach(() => {
    repository = makeRepository({
      'packages/a/src/old.test.ts': OLD_TEST,
      'packages/a/package.json': `${PACKAGE_JSON}\n`,
      'packages/a/tests/test_old.py': 'def test_old():\n    assert run() == 2\n',
    });
  });
  afterEach(() => repository.remove());

  const scan = (args = ['--base', 'HEAD']) =>
    exec('node', [CLI, '--root', repository.root, ...args]);
  const rejects = (rule, result) => {
    assert.equal(result.status, 1, `${result.stdout}${result.stderr}`);
    assert.ok(result.stderr.includes(`[${rule}]`), result.stderr);
  };

  const rejected = [
    [
      'a skip behind a regex literal with a quote',
      'packages/a/src/a.test.ts',
      `const m = /'/; it${SKIP}("x", () => { expect(m).toBe(1); });\n`,
      'test-skip-or-focus',
    ],
    [
      'a skip after a stray apostrophe',
      'packages/a/src/a.test.tsx',
      `const t = <p>don't</p>; it${ONLY}("x", () => { expect(t).toBe(1); });\n`,
      'test-skip-or-focus',
    ],
    [
      'a skip on an alias of the test function',
      'packages/a/src/a.test.ts',
      `const t = it;\nt${SKIP}('x', () => { expect(1).toBe(2); });\n`,
      'test-skip-any-receiver',
    ],
    [
      'a skip on a base test (Playwright fixtures)',
      'projects/p/web/e2e/a.spec.ts',
      `base.test${SKIP}('x', async () => { await expect(page).toHaveURL('/'); });\n`,
      'test-skip-or-focus',
    ],
    [
      'a conditional skip',
      'packages/a/src/a.test.ts',
      `it${join('.skip', 'If')}(flag)('x', () => { expect(1).toBe(2); });\n`,
      'test-skip-or-focus',
    ],
    [
      'a skip through a computed property',
      'packages/a/src/a.test.ts',
      `it['${join('sk', 'ip')}']('x', () => { expect(1).toBe(2); });\n`,
      'test-skip-computed',
    ],
    [
      'an empty test body on one line',
      'packages/a/src/a.test.ts',
      "it('x', async () => {});\n",
      'empty-test-body',
    ],
    [
      'an empty test body on two lines',
      'packages/a/src/a.test.ts',
      "it('x', () => {\n});\n",
      'empty-test-body',
    ],
    ['a test without a callback', 'packages/a/src/a.test.ts', "it('x');\n", 'empty-test-body'],
    [
      'a test that cannot fail',
      'packages/a/src/a.test.ts',
      "it('x', () => {\n  expect(true).toBe(true);\n});\n",
      'test-tautology',
    ],
    [
      'a test with a body but no assertion',
      'packages/a/src/a.test.ts',
      "it('x', () => {\n  const a = 1;\n  console.log(a);\n});\n",
      'test-without-assertion',
    ],
    [
      'a Python skip with the mark import',
      'packages/a/tests/test_a.py',
      join('from pytest import mark\n\n@mark', '.skip', '\ndef test_a():\n    assert 1 == 2\n'),
      'py-test-skip',
    ],
    [
      'a Python skipTest call',
      'packages/a/tests/test_a.py',
      join('def test_a(self):\n    self.skip', 'Test("later")\n'),
      'py-test-skip',
    ],
    [
      'a Python collect_ignore',
      'packages/a/tests/conftest.py',
      join('collect_ignore', ' = ["test_old.py"]\n'),
      'py-collection-hook',
    ],
    [
      'a Python collection hook',
      'packages/a/tests/conftest.py',
      join('def pytest_collection', '_modifyitems(items):\n    items.clear()\n'),
      'py-collection-hook',
    ],
    [
      'a Python test with an empty body',
      'packages/a/tests/test_a.py',
      'def test_a():\n    pass\n',
      'empty-test-body',
    ],
    [
      'a Python test without an assert',
      'packages/a/tests/test_a.py',
      'def test_a():\n    x = run()\n    print(x)\n',
      'test-without-assertion',
    ],
    [
      'a Go skip on a custom receiver',
      'packages/a/a_test.go',
      join('func TestA(t *testing.T) {\n\ts', '.Skip', '("later")\n}\n'),
      'go-test-skip',
    ],
    [
      'a Go testing.Short switch',
      'packages/a/a_test.go',
      join('func TestA(t *testing.T) {\n\tif testing.', 'Short() {\n\t\treturn\n\t}\n}\n'),
      'go-test-skip',
    ],
    [
      'a Go build ignore',
      'packages/a/a_test.go',
      join('//go:build ', 'ignore\n\npackage a\n'),
      'go-build-ignore',
    ],
    [
      'a Go empty test',
      'packages/a/a_test.go',
      'func TestA(t *testing.T) {\n}\n',
      'empty-test-body',
    ],
    [
      'a Bruno stopExecution',
      'projects/p/bruno/a/a.bru',
      join(
        'get {\n  url: {{baseUrl}}/a\n}\n\nassert {\n  res.status: eq 200\n}\n\nscript:post-response {\n  bru.runner.',
        'stop',
        'Execution();\n}\n',
      ),
      'bru-skip-request',
    ],
    [
      'a Bruno setNextRequest with a name',
      'projects/p/bruno/a/a.bru',
      'get {\n  url: {{baseUrl}}/a\n}\n\nassert {\n  res.status: eq 200\n}\n\nscript:post-response {\n  bru.setNextRequest("end");\n}\n',
      'bru-skip-request',
    ],
    [
      'a Bruno request whose assert line is disabled',
      'projects/p/bruno/a/a.bru',
      'get {\n  url: {{baseUrl}}/a\n}\n\nassert {\n  ~res.status: eq 200\n}\n',
      'bru-no-assertion',
    ],
    [
      'a Bruno request with an empty test()',
      'projects/p/bruno/a/a.bru',
      'get {\n  url: {{baseUrl}}/a\n}\n\ntests {\n  test("ok", function () {});\n}\n',
      'bru-no-assertion',
    ],
    [
      'a Bruno request that checks only a constant',
      'projects/p/bruno/a/a.bru',
      'get {\n  url: {{baseUrl}}/a\n}\n\ntests {\n  test("ok", function () {\n    expect(true).to.equal(true);\n  });\n}\n',
      'bru-no-assertion',
    ],
    [
      'a shell script that hides a failure with exit 0',
      'projects/p/api/scripts/check.sh',
      'run_tests || exit 0\n',
      'shell-exit-zero',
    ],
    [
      'set +e in a script',
      'projects/p/api/scripts/check.sh',
      'set +e\nrun_tests\n',
      'shell-exit-zero',
    ],
    [
      'a workflow step with continue-on-error',
      '.github/workflows/extra.yml',
      'jobs:\n  a:\n    steps:\n      - run: x\n        continue-on-error: true\n',
      'shell-exit-zero',
    ],
    [
      'a coverage flag in a script',
      'packages/a/scripts/test.sh',
      'vitest run --coverage.thresholds.lines=0\n',
      'weaken-flag',
    ],
    [
      'max-warnings above zero',
      'packages/a/scripts/lint.sh',
      'eslint --max-warnings 50 .\n',
      'weaken-flag',
    ],
    ['a new pytest.ini', 'packages/a/pytest.ini', '[pytest]\naddopts = -q\n', 'config-shadow-file'],
    // The masker reads a slash after ++, -- or a member named of/in as division, not a regex.
    [
      'a cast to any after a postfix ++ and a division',
      'packages/a/src/a.ts',
      'const half = count++ / 2; const v = data as any; // half/2\n',
      'as-any',
    ],
    [
      'a double cast after a postfix -- and a division',
      'packages/a/src/a.ts',
      'const m = i-- / 2; x as unknown as Y; // ok\n',
      'as-unknown-as',
    ],
    [
      'a cast to any after a member named of',
      'packages/a/src/a.ts',
      'const r = range.of / 2 + (data as any) / 1;\n',
      'as-any',
    ],
    [
      'a cast to any after a member named in',
      'packages/a/src/a.ts',
      'const r = range.in / 2 + (data as any) / 1;\n',
      'as-any',
    ],
    [
      'a focused test after a postfix ++ and a division',
      'packages/a/src/a.test.ts',
      `const n = total++ / 2; it${ONLY}('x', () => { expect(n).toBe(1) }); // a/b\n`,
      'test-skip-or-focus',
    ],
    [
      'a focused test after an identifier and a division',
      'packages/a/src/a.test.ts',
      `const n = total / 2; it${ONLY}('x', () => { expect(n).toBe(1) }); // a/b\n`,
      'test-skip-or-focus',
    ],
    [
      'a focused test after a closing paren and a division',
      'packages/a/src/a.test.ts',
      `const n = (total) / 2; it${ONLY}('x', () => { expect(n).toBe(1) }); // a/b\n`,
      'test-skip-or-focus',
    ],
    // A test command that cannot fail the script.
    ...[
      'go test ./... || echo failed',
      'go test ./... || true',
      'go test ./... || :',
      'go test ./... ; true',
      'uv run pytest || echo failed',
      'npx vitest run --coverage || :',
      'bru run --env local || echo failed',
      'pytest -q; true',
    ].map((command) => [
      `a script that swallows a test failure (${command})`,
      'packages/a/scripts/test.sh',
      `#!/bin/sh\n${command}\n`,
      'test-failure-swallowed',
    ]),
    ...['go test ./... || echo failed', 'vitest run --coverage || true', 'pytest || :'].map(
      (command) => [
        `a phase script that swallows a test failure (${command})`,
        'packages/a/package.json',
        `${PACKAGE_JSON.replace('vitest run --coverage', command)}\n`,
        'test-failure-swallowed',
      ],
    ),
    [
      'a build tag in a Go test file (go:build)',
      'packages/a/a_test.go',
      'package a\n\n//go:build integration\n',
      'go-test-build-tag',
    ],
    [
      'a build tag in a Go test file (+build)',
      'packages/a/a_test.go',
      '// +build integration\n\npackage a\n',
      'go-test-build-tag',
    ],
    [
      'a pytest_sessionfinish hook',
      'packages/a/tests/conftest.py',
      'def pytest_sessionfinish(session, exitstatus):\n    print(exitstatus)\n',
      'py-exit-hook',
    ],
    [
      'a pytest_terminal_summary hook',
      'packages/a/tests/conftest.py',
      'def pytest_terminal_summary(terminalreporter):\n    print("x")\n',
      'py-exit-hook',
    ],
    [
      'an exit status assignment through session.exitstatus',
      'packages/a/tests/conftest.py',
      'def hook(session):\n    session.exitstatus = 0\n',
      'py-exit-hook',
    ],
    [
      'an exit status assignment in a pytest plugin',
      'packages/a/src/a/plugin.py',
      'def finish(session):\n    session.exitstatus = pytest.ExitCode.OK\n',
      'py-exit-hook',
    ],
  ];
  for (const [label, file, content, rule] of rejected) {
    it(`fails on ${label}`, () => {
      repository.write(file, content);
      const result = scan();
      rejects(rule, result);
      assert.ok(
        result.stderr.split('\n').some((line) => line.startsWith(`${file}:`)),
        result.stderr,
      );
    });
  }

  it('fails when a package.json turns a phase script into a no-op', () => {
    repository.write(
      'packages/a/package.json',
      PACKAGE_JSON.replace('vitest run --coverage', 'echo skipped') + '\n',
    );
    rejects('phase-script-neutered', scan());
  });

  it('fails when a package.json adds || true to a phase script', () => {
    repository.write(
      'packages/a/package.json',
      PACKAGE_JSON.replace('vitest run --coverage', 'vitest run --coverage || true') + '\n',
    );
    assert.equal(scan().status, 1);
  });

  it('fails when a package.json drops a phase script', () => {
    repository.write(
      'packages/a/package.json',
      JSON.stringify(
        { name: '@t/a', scripts: { '_phase:lint': 'eslint --max-warnings 0 .' } },
        null,
        2,
      ) + '\n',
    );
    rejects('phase-script-removed', scan());
  });

  it('fails when a package.json adds passWithNoTests or a coverage flag', () => {
    repository.write(
      'packages/a/package.json',
      PACKAGE_JSON.replace('--coverage', '--coverage.enabled=false --passWithNoTests') + '\n',
    );
    const result = scan();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /\[(?:pass-with-no-tests|weaken-flag)\]/);
  });

  it('allows a package.json change that keeps the phase scripts', () => {
    repository.write(
      'packages/a/package.json',
      PACKAGE_JSON.replace('"name": "@t/a"', '"name": "@t/a",\n  "version": "2.0.0"') + '\n',
    );
    assert.equal(scan().status, 0);
  });

  it('fails when a test file is renamed to a path that does not run', () => {
    repository.git('mv', 'packages/a/src/old.test.ts', 'packages/a/src/old.ts');
    rejects('test-file-deleted', scan());
  });

  it('fails when a test file is renamed into a path the scanner skips', () => {
    repository.write('docs/keep.txt', 'x\n');
    repository.git('mv', 'packages/a/src/old.test.ts', 'docs/old.test.ts');
    rejects('test-file-deleted', scan());
  });

  it('allows a test file that is renamed to another test path', () => {
    repository.git('mv', 'packages/a/src/old.test.ts', 'packages/a/src/renamed.test.ts');
    assert.equal(scan().status, 0);
  });

  it('allows a test with an assertion, a helper check and a quoted forbidden word', () => {
    repository.write(
      'packages/a/src/a.test.ts',
      [
        "it('works', () => {",
        '  expect(run()).toBe(2);',
        '});',
        "it('uses a helper', async () => {",
        '  await verifyHealth(app);',
        '});',
        `const text = "it${SKIP}(x)";`,
        '',
      ].join('\n'),
    );
    const result = scan();
    assert.equal(result.status, 0, result.stderr);
  });

  it('allows a Go test that uses a helper that takes t', () => {
    repository.write(
      'packages/a/a_test.go',
      'func TestA(t *testing.T) {\n\tmustHaveTrace(t, run())\n}\n',
    );
    assert.equal(scan().status, 0);
  });

  describe('diff reading', () => {
    it('reads a range, and fails closed on a bad revision', () => {
      repository.write(
        'packages/a/src/a.test.ts',
        `it${SKIP}('x', () => { expect(1).toBe(2); });\n`,
      );
      repository.git('add', '-A');
      repository.git('commit', '-q', '-m', 'bad');
      assert.equal(scan(['--range', 'HEAD~1..HEAD']).status, 1);
      assert.equal(scan(['--range', 'nothere..HEAD']).status, 2);
      assert.equal(scan(['--base', 'nothere']).status, 2);
    });

    it('rejects a revision that git could read as an option', () => {
      const result = scan(['--range', '--output=/tmp/anti-skip-x...HEAD']);
      assert.equal(result.status, 2);
      assert.match(result.stderr, /must not start with "-"/);
      assert.equal(scan(['--base', '--stat']).status, 2);
    });

    it('sees an added skip when the user config turns the diff prefix off', () => {
      repository.git('config', 'diff.noprefix', 'true');
      repository.git('config', 'diff.mnemonicPrefix', 'true');
      repository.write(
        'packages/a/src/old.test.ts',
        `${OLD_TEST}it${SKIP}('b', () => { expect(1).toBe(2); });\n`,
      );
      rejects('test-skip-or-focus', scan());
    });

    it('sees an added skip in a file that .gitattributes marks as not diffable', () => {
      repository.write('.gitattributes', '*.test.ts -diff\n');
      repository.git('add', '-A');
      repository.git('commit', '-q', '-m', 'attributes');
      repository.write(
        'packages/a/src/old.test.ts',
        `${OLD_TEST}it${SKIP}('b', () => { expect(1).toBe(2); });\n`,
      );
      rejects('test-skip-or-focus', scan());
    });

    it('reads a repo that has no commit yet', () => {
      const bare = makeRepository();
      try {
        exec('rm', ['-rf', path.join(bare.root, '.git')]);
        exec('git', ['init', '-q', '-b', 'main'], { cwd: bare.root });
        bare.write('packages/a/src/b.test.ts', `it${SKIP}('x', () => { expect(1).toBe(2); });\n`);
        exec('git', ['add', '-A'], { cwd: bare.root });
        const result = exec('node', [CLI, '--root', bare.root]);
        assert.equal(result.status, 1, result.stderr);
      } finally {
        bare.remove();
      }
    });
  });
});
