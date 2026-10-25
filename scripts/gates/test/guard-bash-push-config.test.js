// guard-bash: an agent must not change the settings that decide what a push with no refspec
// publishes (push.*, remote.<name>.push, .pushurl, .url, .mirror). The agent push rule of
// lib/verify-gate.mjs reads those settings, so a change would turn the rule off (N1).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { bashCall, callHook, editCall, GATES, makeRepository } from './harness.js';

const BLOCKED = [
  ['push.default', 'git config push.default matching'],
  ['push.default in global scope', 'git config --global push.default matching'],
  ['push.default in local scope', 'git config --local --add push.default current'],
  ['push.default in capitals', 'git config PUSH.DEFAULT matching'],
  ['push.followTags', 'git config push.followTags true'],
  ['remote push refspec', 'git config remote.origin.push "refs/heads/*:refs/heads/*"'],
  ['remote push refspec, add', 'git config --add remote.origin.push x'],
  ['remote push refspec, replace', 'git config --replace-all remote.origin.push x'],
  ['remote push refspec, unset', 'git config --unset remote.origin.push'],
  ['remote push refspec, unset all', 'git config --unset-all remote.origin.push'],
  ['remote name with a dot', 'git config remote.my.remote.push x'],
  ['remote pushurl', 'git config remote.origin.pushurl https://example.invalid/x.git'],
  ['remote url', 'git config remote.origin.url https://example.invalid/x.git'],
  ['remote mirror', 'git config remote.origin.mirror true'],
  ['file option', 'git config --file .git/config push.default matching'],
  ['-c push.default', 'git -c push.default=matching push origin HEAD'],
  ['-c with the value attached', 'git -cpush.default=matching push'],
  ['-c remote push refspec', 'git -c "remote.origin.push=refs/heads/*:refs/heads/*" push'],
  ['-c remote url', 'git -c remote.origin.url=https://example.invalid/x.git fetch'],
  ['edit', 'git config --edit'],
  ['edit, short', 'git config -e --global'],
  ['inside bash -c', 'bash -c "git config push.default matching"'],
  ['after another command', 'git status && git config push.default matching'],
  [
    'remote add --mirror=push',
    'git remote add --mirror=push upstream https://example.invalid/x.git',
  ],
  ['remote add --mirror', 'git remote add upstream https://example.invalid/x.git --mirror'],
  [
    'remote add --mirror abbreviated',
    'git remote add --mirr=fetch upstream https://example.invalid/x.git',
  ],
  ['remote set-url', 'git remote set-url origin https://example.invalid/x.git'],
  ['remote set-url --push', 'git remote set-url --push origin https://example.invalid/x.git'],
  ['remote set-branches', 'git remote set-branches origin x'],
  ['push -qf in a short cluster', 'git push -qf origin feature'],
  ['write to .git/config with a redirect', 'echo "[push]" >> .git/config'],
  ['write to .git/config with tee', 'printf "x" | tee -a .git/config'],
  ['write to .git/config with sed', 'sed -i s/a/b/ .git/config'],
];

const ALLOWED = [
  ['read push.default', 'git config push.default'],
  ['read push.default with --get', 'git config --get push.default'],
  ['read a remote push refspec', 'git config --get-all remote.origin.push'],
  ['read a remote url', 'git config --get remote.origin.url'],
  ['read a remote url with one operand', 'git config remote.origin.url'],
  ['read by pattern', 'git config --get-regexp "^remote\\."'],
  ['list', 'git config --list'],
  ['list, short', 'git config -l'],
  ['set an unrelated key', 'git config user.name "Test"'],
  ['read .git/config', 'cat .git/config'],
  ['list remotes', 'git remote -v'],
  ['add a remote', 'git remote add upstream https://example.invalid/x.git'],
  ['status', 'git status'],
];

describe('guard-bash: push settings (N1)', () => {
  let repository;

  before(() => {
    repository = makeRepository({ 'src/app.mjs': 'export const b = 2;\n' });
  });
  after(() => repository.remove());

  const call = (command) => callHook('guard-bash', bashCall(command), { root: repository.root });

  for (const [label, command] of BLOCKED) {
    it(`blocks ${label}`, () => {
      const result = call(command);
      assert.equal(result.status, 2, `${command}\n${result.stdout}${result.stderr}`);
    });
  }

  for (const [label, command] of ALLOWED) {
    it(`allows ${label}`, () => {
      const result = call(command);
      assert.equal(result.status, 0, `${command}\n${result.stdout}${result.stderr}`);
    });
  }

  it('gives a reason that names the push settings', () => {
    const result = call('git config push.default matching');
    assert.match(result.stdout + result.stderr, /push\.\* or remote\.<name>\.push/);
  });

  it('keeps the old rules: core.hooksPath and alias', () => {
    assert.equal(call('git config core.hooksPath /tmp/x').status, 2);
    assert.equal(call('git config alias.p push').status, 2);
  });
});

describe('.git/config is a gate file (N1)', () => {
  it('has an entry in gate-files.json with a why line', () => {
    const { gates } = JSON.parse(fs.readFileSync(path.join(GATES, 'gate-files.json'), 'utf8'));
    const entry = gates.find((gate) => gate.glob === '.git/config');
    assert.ok(entry !== undefined, 'no gate entry for .git/config');
    assert.ok(entry.why.length > 20);
  });

  it('is refused by the edit hook for Write and Edit', () => {
    const repository = makeRepository({ 'src/app.mjs': 'export const b = 2;\n' });
    try {
      for (const tool of ['Write', 'Edit']) {
        const target = path.join(repository.root, '.git/config');
        const result = callHook('protect-gates', editCall(tool, target), {
          root: repository.root,
        });
        assert.equal(result.status, 2, `${tool}\n${result.stdout}${result.stderr}`);
      }
    } finally {
      repository.remove();
    }
  });
});
