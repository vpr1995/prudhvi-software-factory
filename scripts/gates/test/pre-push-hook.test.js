// Tests for common/git-hooks/pre-push: it pushes only the checked-out commit from a clean tree, then
// starts the gate runner. The hook runs for real in a temp repo with a stub runner. The fixture
// commits are made with `git commit-tree` (no hooks are involved).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { exec, REPOSITORY } from './harness.js';

const HOOK = path.join(REPOSITORY, 'common', 'git-hooks', 'pre-push');
const ZERO = '0'.repeat(40);
const STUB_RUNNER = '#!/usr/bin/env bash\necho "runner stub ran"\n';
const IDENTITY = {
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};

describe('pre-push hook', () => {
  /** @type {string} */
  let root;
  /** @type {string} */
  let first;
  /** @type {string} */
  let second;

  /**
   * Runs git in the temp repo.
   *
   * @param {...string} args - Git arguments.
   * @returns {string} Standard output, trimmed.
   */
  const git = (...args) => {
    const result = exec('git', args, { cwd: root, env: IDENTITY });
    assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
    return result.stdout.trim();
  };

  /**
   * Writes a file in the temp repo.
   *
   * @param {string} name - Path from the repo root.
   * @param {string} text - Content.
   * @returns {void}
   */
  const write = (name, text) => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };

  /**
   * Commits the index with plumbing and moves main to the new commit.
   *
   * @param {string} message - Commit message.
   * @param {string} [parent] - Parent commit.
   * @returns {string} The new commit id.
   */
  const commitTree = (message, parent) => {
    git('add', '-A');
    const tree = git('write-tree');
    const sha = git('commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', message);
    git('update-ref', 'refs/heads/main', sha);
    return sha;
  };

  /**
   * Runs the hook like git does: the pushed refs on stdin.
   *
   * @param {string[]} lines - `<local ref> <local sha> <remote ref> <remote sha>` lines.
   * @returns {{ status: number, stdout: string, stderr: string }} Result.
   */
  const push = (lines) =>
    exec('sh', [HOOK, 'origin', '/tmp/origin.git'], {
      cwd: root,
      input: lines.map((line) => `${line}\n`).join(''),
    });

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pre-push-test-')));
    git('init', '-q', '-b', 'main');
    write('scripts/gates/local-gates.sh', STUB_RUNNER);
    write('a.txt', 'one\n');
    first = commitTree('first');
    write('a.txt', 'two\n');
    second = commitTree('second', first);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('runs the gates when the pushed sha is HEAD', () => {
    const result = push([`refs/heads/main ${second} refs/heads/main ${first}`]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'runner stub ran\n');
  });

  it('fails when a pushed sha is not HEAD, and does not run the gates', () => {
    const result = push([
      `refs/heads/main ${second} refs/heads/main ${ZERO}`,
      `refs/heads/old ${first} refs/heads/old ${ZERO}`,
    ]);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /pre-push: push the checked-out commit only \(git push origin HEAD:main\); the gates check HEAD/,
    );
    assert.ok(
      result.stderr.includes(`refs/heads/old is ${first}, HEAD is ${second}\n`),
      result.stderr,
    );
    assert.doesNotMatch(result.stdout, /runner stub ran/);
  });

  it('allows a delete with a message, then runs the gates', () => {
    const result = push([`(delete) ${ZERO} refs/heads/gone ${first}`]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      result.stdout,
      `pre-push: deleting refs/heads/gone (allowed; was ${first})\nrunner stub ran\n`,
    );
  });

  it('fails when tracked files have uncommitted changes, staged or not', () => {
    write('a.txt', 'dirty\n');
    const unstaged = push([`refs/heads/main ${second} refs/heads/main ${first}`]);
    assert.equal(unstaged.status, 1);
    assert.match(unstaged.stderr, /pre-push: tracked files have uncommitted changes/);
    assert.doesNotMatch(unstaged.stdout, /runner stub ran/);
    git('add', 'a.txt');
    assert.equal(push([`refs/heads/main ${second} refs/heads/main ${first}`]).status, 1);
  });

  it('allows untracked files', () => {
    write('notes.txt', 'scratch\n');
    const result = push([`refs/heads/main ${second} refs/heads/main ${first}`]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'runner stub ran\n');
  });

  it('fails a dirty tree even when the push only deletes', () => {
    write('a.txt', 'dirty\n');
    assert.equal(push([`(delete) ${ZERO} refs/heads/gone ${first}`]).status, 1);
  });
});
