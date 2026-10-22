// A `#` starts a comment only at the start of a word, outside quotes, and the comment ends at the
// end of the line. A `<<X` or an unbalanced quote inside a comment must not hide later lines.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { checkCommand } from '../lib/bash-rules.mjs';
import { parseShell } from '../lib/shell-parse.mjs';
import { guardedCommand } from '../lib/verify-gate.mjs';

import { bashCall, callHook, makeRepository } from './harness.js';

const argvs = (command) => parseShell(command).map((segment) => segment.argv);

describe('shell comments', () => {
  let repository;

  before(() => {
    repository = makeRepository({ '.claude/hooks/guard-bash.sh': '#!/usr/bin/env bash\n' });
  });
  after(() => repository.remove());

  const context = () => ({
    root: repository.root,
    cwd: repository.root,
    currentBranch: () => 'feat/x',
  });
  const guard = (command) => callHook('guard-bash', bashCall(command), { root: repository.root });
  const verify = (command) =>
    callHook('require-verify', bashCall(command), { root: repository.root });

  describe('a comment does not hide the lines after it', () => {
    it('keeps the force push after a comment that holds a here-document marker', () => {
      const command = '# <<X\ngit push --force origin main';
      assert.notEqual(checkCommand(command, context()), null);
      assert.equal(guard(command).status, 2);
    });

    it('sees the PR creation after a trailing comment with a marker', () => {
      const command = 'true # <<X\ngh pr create -t x -b y';
      assert.equal(guardedCommand(command, repository.root), 'gh pr create');
      assert.equal(verify(command).status, 2);
    });

    it('keeps the delete after a comment with an apostrophe', () => {
      const command = "echo hi # it's\nrm -rf .claude/hooks";
      assert.notEqual(checkCommand(command, context()), null);
      assert.equal(guard(command).status, 2);
    });

    it('keeps the lines after a comment with a double quote or a lone quote', () => {
      for (const command of [
        '# "\ngit commit --no-verify -m a',
        "echo hi # don't\nrm -rf .claude/hooks",
        "# it's\ngit push --force",
        '# `\ngit push -f',
        '# $(\ngit push -f',
      ]) {
        assert.notEqual(checkCommand(command, context()), null, command);
      }
    });

    it('reads the here-document body after a comment on the operator line', () => {
      const command = 'cat <<EOF # note\nbody\nEOF\ngit push --force origin main';
      assert.notEqual(checkCommand(command, context()), null);
    });

    it('checks a comment line inside a here-document that feeds a shell', () => {
      const command = 'bash <<EOF\n# comment\necho x > .claude/hooks/guard-bash.sh\nEOF';
      assert.notEqual(checkCommand(command, context()), null);
    });

    it('splits the commands around a comment', () => {
      assert.deepEqual(argvs("echo hi # it's\nrm -rf x"), [
        ['echo', 'hi'],
        ['rm', '-rf', 'x'],
      ]);
      assert.deepEqual(argvs('echo hi;#c\nls'), [['echo', 'hi'], ['ls']]);
      assert.deepEqual(argvs('echo hi && # c <<X\nls'), [['echo', 'hi'], ['ls']]);
    });
  });

  describe('a hash that is not at a word start stays text', () => {
    it('keeps # inside words, quotes and expansions', () => {
      assert.deepEqual(argvs('echo a#b'), [['echo', 'a#b']]);
      assert.deepEqual(argvs('echo "x # y"'), [['echo', 'x # y']]);
      assert.deepEqual(argvs("echo 'x # y' z"), [['echo', 'x # y', 'z']]);
      assert.deepEqual(argvs('echo $# ${#x}'), [['echo', '$#', '${#x}']]);
      assert.deepEqual(argvs(String.raw`echo \# x`), [['echo', '#', 'x']]);
    });

    it('ends a comment at the end of its line only', () => {
      assert.deepEqual(argvs('echo a #b\necho c'), [
        ['echo', 'a'],
        ['echo', 'c'],
      ]);
    });

    it('still blocks a command that follows a hash inside a word or a quote', () => {
      for (const command of [
        'echo a#b; git push --force',
        'echo "x # y"; git push --force',
        "echo 'x # y' && git push -f",
      ]) {
        assert.notEqual(checkCommand(command, context()), null, command);
      }
    });

    it('allows normal commands that hold a hash', () => {
      for (const command of [
        'echo a#b',
        'echo "x # y"',
        "ls # it's a list",
        'git status # <<X',
        'git commit -m "fix: issue #12"',
      ]) {
        assert.equal(checkCommand(command, context()), null, command);
      }
    });
  });
});
