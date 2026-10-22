import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { callHook, editCall, makeRepository } from './harness.js';

describe('protect-gates', () => {
  let repository;

  before(() => {
    repository = makeRepository({ 'tooling/rule.js': 'x\n', '.github/workflows/ci.yml': 'x\n' });
    fs.symlinkSync(
      path.join(repository.root, 'tooling'),
      path.join(repository.root, 'packages', 'link'),
    );
  });

  after(() => repository.remove());

  const blocked = [
    ['Write', 'tooling/new.js'],
    ['Edit', 'tooling/rule.js'],
    ['MultiEdit', 'rush.json'],
    ['NotebookEdit', 'tooling/notebook.ipynb'],
    ['Write', '.github/workflows/ci.yml'],
    ['Write', '.GITHUB/workflows/ci.yml'],
    ['Write', 'packages/a/vitest.config.ts'],
    ['Write', 'packages/a/tsconfig.build.json'],
    ['Write', 'projects/x/web/playwright.config.ts'],
    ['Write', 'projects/x/api/pyproject.toml'],
    ['Write', 'common/config/rush/pnpm-lock.yaml'],
    ['Write', 'scripts/gates/lib/x.mjs'],
    ['Write', '.claude/hooks/stop-gate.sh'],
    ['Write', '.claude/settings.json'],
    ['Write', '.claude/settings.pending.json'],
    ['Write', 'packages/a/../../tooling/dotdot.js'],
    ['Write', 'packages/link/through-symlink.js'],
    ['Write', 'projects/x/REVIEW.md'],
    ['Write', 'projects/x/infra/cdk.json'],
    // Trust files of the verify and stop gates: a written state file would fake a pass.
    ['Write', '.claude/state/last-verify.json'],
    ['Edit', '.claude/state/session-base'],
    ['Write', '.claude/state/stop-attempts'],
    ['Write', '.claude/state/subagent-stop-attempts'],
    // Scripts that the _phase:* commands run, tool configs, and Rush's own scripts.
    ['Write', 'scripts/other.mjs'],
    ['Write', 'packages/a/scripts/test.sh'],
    ['Write', 'common/scripts/install-run.js'],
    ['Write', 'projects/x/api-go/go.mod'],
    ['Write', 'projects/x/api-py/pytest.ini'],
    ['Write', 'projects/x/api-py/ruff.toml'],
    ['Write', 'projects/x/api-py/.coveragerc'],
    ['Write', 'projects/x/bruno/bruno.json'],
    ['Write', '.gitattributes'],
  ];
  for (const [tool, file] of blocked) {
    it(`blocks ${tool} ${file}`, () => {
      const target = path.isAbsolute(file) ? file : path.join(repository.root, file);
      const result = callHook('protect-gates', editCall(tool, target), { root: repository.root });
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, /BLOCKED by protect-gates/);
      assert.match(result.stderr, /human/);
    });
  }

  it('blocks a relative path too', () => {
    const result = callHook('protect-gates', editCall('Write', 'tooling/relative.js'), {
      root: repository.root,
    });
    assert.equal(result.status, 2);
  });

  const allowed = [
    'packages/a/src/a.ts',
    'packages/a/src/new-file.ts',
    'projects/x/api/src/routes/notes.ts',
    'docs/notes.md',
    'tools/other.mjs',
    '.claude/state/verify-output.log',
    '.claude/state/handoff/new-project/README.md',
    'projects/x/api-py/tests/conftest.py',
    'packages/a/package.json',
  ];
  for (const file of allowed) {
    it(`allows ${file}`, () => {
      const result = callHook(
        'protect-gates',
        editCall('Write', path.join(repository.root, file)),
        { root: repository.root },
      );
      assert.equal(result.status, 0, result.stderr);
    });
  }

  it('allows a file outside the repo', () => {
    const result = callHook('protect-gates', editCall('Write', '/tmp/outside-the-repo.txt'), {
      root: repository.root,
    });
    assert.equal(result.status, 0, result.stderr);
  });

  it('blocks when the hook input is not JSON (fail closed)', () => {
    const result = callHook('protect-gates', 'not json', { root: repository.root });
    assert.equal(result.status, 2);
  });
});
