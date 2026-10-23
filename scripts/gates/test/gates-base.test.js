// Tests for the base of the local gate run (lib/gates-base.mjs, gates-base.mjs) and for the runner
// local-gates.sh. Everything runs for real against temp git repos.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { formatBase, gatesBaseFile, resolveGatesBase } from '../lib/gates-base.mjs';

import { exec, GATES, makeRepository } from './harness.js';

const CLI = path.join(GATES, 'gates-base.mjs');

/**
 * Adds a commit that changes one file.
 *
 * @param {ReturnType<typeof makeRepository>} repository - The repo.
 * @param {string} text - New text of packages/a/src/a.ts.
 * @returns {string} The new commit id.
 */
function commit(repository, text) {
  repository.write('packages/a/src/a.ts', text);
  repository.git('add', '-A');
  repository.git('commit', '-q', '-m', text.trim());
  return repository.git('rev-parse', 'HEAD').trim();
}

describe('gates base', () => {
  /** @type {ReturnType<typeof makeRepository>} */
  let repository;
  /** @type {string} */
  let first;
  /** @type {string} */
  let second;

  beforeEach(() => {
    repository = makeRepository();
    first = repository.git('rev-parse', 'HEAD').trim();
    second = commit(repository, 'export const value = 2;\n');
    commit(repository, 'export const value = 3;\n');
  });

  afterEach(() => {
    repository.remove();
  });

  it('falls back to the root commit when nothing else exists', () => {
    assert.deepEqual(resolveGatesBase(repository.root), {
      sha: first,
      source: 'root',
      detail: 'root commit',
    });
  });

  it('uses the merge base of origin/main and HEAD', () => {
    repository.git('update-ref', 'refs/remotes/origin/main', second);
    assert.equal(resolveGatesBase(repository.root).source, 'origin');
    assert.equal(resolveGatesBase(repository.root).sha, second);
    // origin/main moved on with a commit that HEAD does not have: the base is the fork point.
    repository.git('checkout', '-q', '-b', 'other', second);
    const remoteOnly = commit(repository, 'export const value = 9;\n');
    repository.git('checkout', '-q', 'main');
    repository.git('update-ref', 'refs/remotes/origin/main', remoteOnly);
    assert.equal(resolveGatesBase(repository.root).sha, second);
  });

  it('uses the merge base of the upstream when origin/main is missing', () => {
    repository.git('branch', 'base-branch', first);
    repository.git('checkout', '-q', '-b', 'feature');
    repository.git('branch', '--set-upstream-to=base-branch');
    assert.deepEqual(resolveGatesBase(repository.root), {
      sha: first,
      source: 'upstream',
      detail: 'base-branch',
    });
  });

  it('prefers origin/main over the upstream', () => {
    repository.git('branch', 'base-branch', first);
    repository.git('checkout', '-q', '-b', 'feature');
    repository.git('branch', '--set-upstream-to=base-branch');
    repository.git('update-ref', 'refs/remotes/origin/main', second);
    assert.equal(resolveGatesBase(repository.root).source, 'origin');
  });

  it('uses .claude/state/gates-base when there is no remote branch and no upstream', () => {
    repository.write('.claude/state/gates-base', `${second}\n`);
    assert.equal(
      gatesBaseFile(repository.root),
      path.join(repository.root, '.claude', 'state', 'gates-base'),
    );
    assert.deepEqual(resolveGatesBase(repository.root), {
      sha: second,
      source: 'state',
      detail: '.claude/state/gates-base',
    });
  });

  it('prefers the upstream over the state file', () => {
    repository.write('.claude/state/gates-base', `${second}\n`);
    repository.git('branch', 'base-branch', first);
    repository.git('checkout', '-q', '-b', 'feature');
    repository.git('branch', '--set-upstream-to=base-branch');
    assert.equal(resolveGatesBase(repository.root).source, 'upstream');
  });

  it('puts GATES_BASE before every other source', () => {
    repository.git('update-ref', 'refs/remotes/origin/main', second);
    repository.write('.claude/state/gates-base', `${second}\n`);
    assert.deepEqual(resolveGatesBase(repository.root, { envBase: 'HEAD~2' }), {
      sha: first,
      source: 'env',
      detail: 'GATES_BASE=HEAD~2',
    });
  });

  it('treats an empty GATES_BASE as not set', () => {
    assert.equal(resolveGatesBase(repository.root, { envBase: '  ' }).source, 'root');
  });

  it('fails on a GATES_BASE that is not a commit, and does not fall through', () => {
    repository.git('update-ref', 'refs/remotes/origin/main', second);
    assert.throws(
      () => resolveGatesBase(repository.root, { envBase: 'no-such-ref' }),
      /GATES_BASE is set, but it is not a commit/,
    );
    assert.throws(() => resolveGatesBase(repository.root, { envBase: '--all' }), /GATES_BASE/);
  });

  it('fails on a state file that is not a commit, and does not fall back to the root commit', () => {
    repository.write('.claude/state/gates-base', 'deadbeef\n');
    assert.throws(() => resolveGatesBase(repository.root), /gates-base holds "deadbeef"/);
  });

  it('formats the log line', () => {
    assert.equal(
      formatBase({ sha: first, source: 'root', detail: 'root commit' }),
      `gates: base ${first} (root: root commit)`,
    );
  });

  it('CLI prints "<sha> <source>" on stdout and the base line on stderr', () => {
    const result = exec('node', [CLI, '--root', repository.root], { env: { GATES_BASE: '' } });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `${first} root\n`);
    assert.equal(result.stderr, `gates: base ${first} (root: root commit)\n`);
    const fromEnv = exec('node', [CLI, '--root', repository.root], { env: { GATES_BASE: second } });
    assert.equal(fromEnv.stdout, `${second} env\n`);
  });

  it('CLI exits 2 on a bad GATES_BASE and on bad usage', () => {
    const bad = exec('node', [CLI, '--root', repository.root], { env: { GATES_BASE: 'nope' } });
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /gates: no base: GATES_BASE is set/);
    assert.equal(bad.stdout, '');
    assert.equal(exec('node', [CLI, '--bogus']).status, 2);
  });
});

describe('local-gates.sh runner', () => {
  /** @type {ReturnType<typeof makeRepository>} */
  let repository;

  beforeEach(() => {
    repository = makeRepository();
    // The runner calls the gate scripts by repo path, so the temp repo gets a copy of them.
    fs.cpSync(GATES, path.join(repository.root, 'scripts', 'gates'), {
      recursive: true,
      filter: (source) => !source.split(path.sep).includes('node_modules'),
    });
  });

  afterEach(() => {
    repository.remove();
  });

  /**
   * Runs the runner in the temp repo.
   *
   * @param {Record<string, string>} [env] - Extra variables.
   * @returns {{ status: number, stdout: string, stderr: string }} Result.
   */
  function runGates(env = {}) {
    return exec('bash', [path.join(repository.root, 'scripts', 'gates', 'local-gates.sh')], {
      cwd: repository.root,
      env: { GATES_BASE: '', GATE_LABELS: '', ...env },
    });
  }

  /**
   * Reads the Rush calls of the stub.
   *
   * @returns {string[]} One entry for each call.
   */
  function rushCalls() {
    return (repository.read('common/temp/stub-calls.log') ?? '').split('\n').filter(Boolean);
  }

  it('prints the base, skips rush change without a remote, and stops at the first failure', () => {
    repository.write('common/temp/stub-fail', '');
    const result = runGates();
    assert.equal(result.status, 1);
    const root = repository.git('rev-parse', 'HEAD').trim();
    assert.ok(result.stderr.includes(`gates: base ${root} (root: root commit)\n`), result.stderr);
    assert.match(
      result.stdout,
      /gates: SKIP rush change --verify \(no origin remote; rush change needs a remote\)/,
    );
    assert.match(result.stderr, /gates: FAIL rush audit \(exit 1\)/);
    assert.deepEqual(rushCalls(), ['audit']);
    assert.doesNotMatch(result.stdout, /gates: RUN rush license-check/);
  });

  it('runs the steps in order and fails a step whose script is missing', () => {
    // scripts/security is not in the temp repo, so the opengrep step fails after audit and licenses.
    const result = runGates();
    assert.equal(result.status, 1);
    assert.deepEqual(rushCalls(), ['audit', 'license-check']);
    assert.match(result.stdout, /gates: PASS rush audit\ngates: RUN rush license-check/);
    assert.match(result.stderr, /gates: FAIL opengrep/);
    assert.doesNotMatch(result.stdout, /gates: RUN anti-skip/);
  });

  it('runs rush change --verify when an origin remote exists', () => {
    repository.git('remote', 'add', 'origin', repository.root);
    repository.write('common/temp/stub-fail', '');
    const result = runGates();
    assert.equal(result.status, 1);
    assert.deepEqual(rushCalls(), ['change --verify --no-fetch']);
    assert.match(result.stderr, /gates: FAIL rush change --verify/);
  });

  it('fails before any step when GATES_BASE is not a commit', () => {
    const result = runGates({ GATES_BASE: 'no-such-ref' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /gates: FAIL base/);
    assert.deepEqual(rushCalls(), []);
  });
});
