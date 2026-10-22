// guard-bash: directory targets for .claude/state, links to gate files, and `gh pr new`.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { guardedCommand } from '../lib/verify-gate.mjs';

import { bashCall, callHook, makeRepository } from './harness.js';

describe('guard-bash: state folder, links and gh pr new', () => {
  let repository;

  before(() => {
    repository = makeRepository({
      'scripts/gates/lib/fs-io.mjs': 'export const a = 1;\n',
      'src/app.mjs': 'export const b = 2;\n',
    });
    // The state folder is ignored by git, so no git command lists its files.
    repository.write('.claude/state/last-verify.json', '{}\n');
    repository.write('.claude/state/session-base', 'abc\n');
  });
  after(() => repository.remove());

  const check = (command) => callHook('guard-bash', bashCall(command), { root: repository.root });

  const stateBlocked = [
    ['cp into the folder', 'cp /tmp/fake/last-verify.json .claude/state/'],
    ['cp into the folder without a slash', 'cp /tmp/fake/last-verify.json .claude/state'],
    ['mv into the folder', 'mv /tmp/fake/last-verify.json .claude/state/'],
    ['install into the folder', 'install /tmp/fake/last-verify.json .claude/state/'],
    ['install -t', 'install -t .claude/state /tmp/fake/last-verify.json'],
    ['cp -t', 'cp -t .claude/state/ /tmp/fake/last-verify.json'],
    ['cp -r of a folder', 'cp -r /tmp/fake/. .claude/state/'],
    ['rsync into the folder', 'rsync -a /tmp/fakestate/ .claude/state/'],
    ['ln into the folder', 'ln /tmp/fake/last-verify.json .claude/state/'],
    ['ln -s into the folder', 'ln -s /tmp/fake/last-verify.json .claude/state/'],
    ['mv the folder away', 'mv .claude/state /tmp/s'],
    ['mv the folder away with a slash', 'mv .claude/state/ /tmp/s'],
    ['mv a folder over it', 'mv /tmp/s .claude/state'],
    ['ln -s replacing the folder', 'ln -s /tmp/fakestate .claude/state'],
    ['ln -sfn replacing the folder', 'ln -sfn /tmp/fakestate .claude/state'],
    ['rm -rf the folder', 'rm -rf .claude/state/'],
    ['cd into it, then cp to .', 'cd .claude/state && cp /tmp/fake/last-verify.json .'],
    [
      'node rmSync of the folder',
      `node -e "require('fs').rmSync('.claude/state',{recursive:true})"`,
    ],
    ['python rmtree of the folder', `python3 -c "import shutil;shutil.rmtree('.claude/state')"`],
  ];
  for (const [label, command] of stateBlocked) {
    it(`blocks ${label}`, () => {
      const result = check(command);
      assert.equal(result.status, 2, command);
      assert.match(result.stderr, /BLOCKED by guard-bash/);
    });
  }

  it('still lets an agent read and copy out of the state folder', () => {
    for (const command of [
      'cat .claude/state/last-verify.json',
      'ls .claude/state',
      'cp .claude/state/last-verify.json /tmp/copy.json',
      'cp -r .claude/state /tmp/state-copy',
    ]) {
      assert.equal(check(command).status, 0, command);
    }
  });

  const linkBlocked = [
    ['cp -l of a gate file', 'cp -l scripts/gates/lib/fs-io.mjs /tmp/hard'],
    ['cp --link of a gate file', 'cp --link scripts/gates/lib/fs-io.mjs /tmp/hard'],
    ['cp -al of a gate folder', 'cp -al scripts/gates /tmp/hardgates'],
    ['cp -rl of a gate folder', 'cp -rl scripts/gates /tmp/hg'],
    ['cp -l with -t', 'cp -l -t /tmp/dest scripts/gates/lib/fs-io.mjs'],
    ['ln -s with a gate file as source', 'ln -s scripts/gates/lib/fs-io.mjs /tmp/l'],
    [
      'ln -s with a source that is relative to the link folder',
      'ln -s ../scripts/gates/lib/fs-io.mjs src/alias.mjs',
    ],
    [
      'ln -sf with a source that is relative to the link folder',
      'ln -sf ../scripts/gates/lib/fs-io.mjs src/alias.mjs',
    ],
    ['ln -s -t with a gate file', 'ln -s -t /tmp scripts/gates/lib/fs-io.mjs'],
    ['ln with a gate file', 'ln scripts/gates/lib/fs-io.mjs /tmp/l'],
    ['ln -s after cd', 'cd scripts/gates && ln -s lib/fs-io.mjs /tmp/l'],
  ];
  for (const [label, command] of linkBlocked) {
    it(`blocks ${label}`, () => {
      assert.equal(check(command).status, 2, command);
    });
  }

  it('blocks a link to the gate file by its absolute path', () => {
    assert.equal(check(`ln -s ${repository.root}/scripts/gates/lib/fs-io.mjs /tmp/l`).status, 2);
  });

  it('still allows a copy and links between plain files', () => {
    for (const command of [
      'cp scripts/gates/lib/fs-io.mjs /tmp/copy.mjs',
      'cp -L src/app.mjs /tmp/copy.mjs',
      'cp -l src/app.mjs /tmp/hard.mjs',
      'ln -s ../src/app.mjs /tmp/alias.mjs',
      'ln -s app.mjs src/alias.mjs',
    ]) {
      assert.equal(check(command).status, 0, command);
    }
  });

  it('counts gh pr new as gh pr create', () => {
    for (const command of [
      'gh pr new --fill',
      'gh pr new -t x -b y',
      'gh -R o/r pr new --fill',
      'gh --repo o/r pr new',
      'echo hi; gh pr new',
    ]) {
      assert.equal(guardedCommand(command, repository.root), 'gh pr create', command);
    }
    assert.equal(guardedCommand('gh pr view 1', repository.root), null);
  });
});
