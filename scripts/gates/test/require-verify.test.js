import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { bashCall, callHook, makeRepository } from './harness.js';

describe('require-verify', () => {
  let repository;

  before(() => {
    repository = makeRepository();
    // A real session has a session base: session-start writes it. Without it a push is refused.
    repository.write(
      '.claude/state/session-base',
      `${repository.git('rev-parse', 'HEAD').trim()}\n`,
    );
  });

  after(() => repository.remove());

  const check = (command) =>
    callHook('require-verify', bashCall(command), { root: repository.root });
  const writeState = () =>
    callHook('stop-gate', null, { root: repository.root, args: ['--write-state-only'] });

  it('does not touch other commands', () => {
    for (const command of [
      'git status',
      'git commit -m x',
      'node common/scripts/install-run-rush.js build',
      'gh pr view 1',
    ]) {
      assert.equal(check(command).status, 0, command);
    }
  });

  it('blocks gh pr create and git push when there is no state file', () => {
    for (const command of [
      'gh pr create --fill',
      'git push origin HEAD',
      'cd x && git push',
      'echo hi; gh pr create --body-file b.md',
    ]) {
      const result = check(command);
      assert.equal(result.status, 2, command);
      assert.match(result.stderr, /BLOCKED by require-verify/);
      assert.match(result.stderr, /no \.claude\/state\/last-verify\.json/);
    }
  });

  it('does not block a commit message that mentions git push', () => {
    assert.equal(check('git commit -m "docs: run git push after verify"').status, 0);
  });

  it('allows the command after a passing verify, and blocks it again when the tree changes', () => {
    assert.equal(writeState().status, 0);
    assert.equal(check('gh pr create --fill').status, 0);
    repository.write('packages/a/src/b.ts', 'export const b = 2;\n');
    const result = check('git push');
    assert.equal(result.status, 2);
    assert.match(result.stderr, /changed after the last passing verify/);
  });

  it('keeps allowing the push after the verified tree is committed', () => {
    assert.equal(writeState().status, 0);
    repository.git('add', '-A');
    repository.git('commit', '-q', '-m', 'feat: b');
    assert.equal(check('git push origin HEAD').status, 0);
  });

  it('blocks when the state says fail', () => {
    repository.write('common/temp/stub-fail', '1');
    repository.write('packages/a/src/c.ts', 'export const c = 3;\n');
    assert.equal(writeState().status, 1);
    const result = check('git push');
    assert.equal(result.status, 2);
    assert.match(result.stderr, /did not pass/);
  });

  it('does not accept a hand-written pass state', () => {
    repository.write(
      '.claude/state/last-verify.json',
      JSON.stringify({ version: 1, status: 'pass', treeHash: 'forged', contentHash: 'forged' }),
    );
    assert.equal(check('git push').status, 2);
  });
});
