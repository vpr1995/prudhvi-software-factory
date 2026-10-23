// The Stop hook and require-verify use gate-integrity: they read git and the file system, not the
// command text and not .claude/state.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { bashCall, callHook, exec, makeRepository } from './harness.js';

const GATE = 'scripts/gates/lib/fs-io.mjs';
const PACKAGE = 'packages/a/package.json';
const PACKAGE_TEXT = `${JSON.stringify(
  { name: '@t/a', version: '1.0.0', scripts: { '_phase:test': 'vitest run', build: 'tsc' } },
  null,
  2,
)}\n`;
const REVERT_TEXT = 'Gate file changed. Revert it (git checkout -- ';

describe('gate integrity in the hooks', () => {
  let repository;

  beforeEach(() => {
    repository = makeRepository({
      [GATE]: 'export const a = 1;\n',
      [PACKAGE]: PACKAGE_TEXT,
    });
  });
  afterEach(() => repository.remove());

  const stop = (options = {}) =>
    callHook(
      'stop-gate',
      { hookEventName: 'Stop', stopHookActive: options.active === true },
      { root: repository.root, args: options.args ?? [] },
    );
  const check = (command) =>
    callHook('require-verify', bashCall(command), { root: repository.root });
  const writeState = () =>
    callHook('stop-gate', null, { root: repository.root, args: ['--write-state-only'] });
  const editGate = () =>
    fs.writeFileSync(path.join(repository.root, GATE), 'export const a = 2;\n');
  const commit = (message) => {
    repository.git('add', '-A');
    repository.git('commit', '-q', '-m', message);
  };
  const setSessionBase = (sha) => repository.write('.claude/state/session-base', `${sha}\n`);
  const head = () => repository.git('rev-parse', 'HEAD').trim();
  const message = (result) => JSON.parse(result.stdout)['systemMessage'];

  describe('Stop', () => {
    it('passes on a clean repo and prints nothing', () => {
      const result = stop();
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, '');
    });

    it('blocks when a gate file is changed, and names the file with the revert text', () => {
      editGate();
      const result = stop();
      assert.equal(result.status, 2, result.stdout);
      assert.match(result.stderr, /^STOP BLOCKED: 1 gate file change:/);
      assert.ok(result.stderr.includes(GATE), result.stderr);
      assert.ok(result.stderr.includes(`${REVERT_TEXT}${GATE}) or ask the human.`), result.stderr);
    });

    it('blocks the quick SubagentStop run too', () => {
      editGate();
      const result = stop({ args: ['--fast'] });
      assert.equal(result.status, 2, result.stdout);
      assert.ok(result.stderr.includes(GATE), result.stderr);
      assert.ok(result.stderr.includes(REVERT_TEXT), result.stderr);
    });

    it('blocks although the saved verify state says pass for this exact tree', () => {
      editGate();
      assert.equal(writeState().status, 0);
      const saved = JSON.parse(repository.read('.claude/state/last-verify.json'));
      assert.equal(saved.status, 'pass');
      const result = stop();
      assert.equal(result.status, 2, result.stdout);
      assert.ok(result.stderr.includes(GATE), result.stderr);
    });

    it('blocks for a new gate file, for a gitignored one and for a _phase change', () => {
      repository.write('.gitignore', 'common/temp/\n.claude/state/\nnode_modules/\npytest.toml\n');
      commit('ignore pytest.toml');
      repository.write('.github/workflows/new.yml', 'name: x\n');
      repository.write('projects/x/src/api-py/pytest.toml', '[pytest]\n');
      repository.write(
        PACKAGE,
        `${JSON.stringify({ name: '@t/a', version: '1.0.0', scripts: { '_phase:test': 'vitest --version', build: 'tsc' } }, null, 2)}\n`,
      );
      const result = stop();
      assert.equal(result.status, 2, result.stdout);
      for (const name of [
        '.github/workflows/new.yml',
        'projects/x/src/api-py/pytest.toml',
        PACKAGE,
        '_phase:test changed',
      ]) {
        assert.ok(result.stderr.includes(name), `${name}\n${result.stderr}`);
      }
    });

    it('ends the loop after three blocks and the warning still names the file', () => {
      editGate();
      assert.equal(stop().status, 2);
      assert.equal(stop({ active: true }).status, 2);
      const third = stop({ active: true });
      assert.equal(third.status, 2);
      assert.match(third.stderr, /LAST RETRY/);
      const last = stop({ active: true });
      assert.equal(last.status, 0, last.stderr);
      assert.match(message(last), /3 stops were blocked/);
      assert.ok(message(last).includes(GATE), message(last));
    });

    it('passes with a warning when commits since the session base change gate files', () => {
      setSessionBase(head());
      editGate();
      commit('agent commits a gate change');
      const result = stop();
      assert.equal(result.status, 0, result.stderr);
      assert.match(message(result), /^WARNING: .*fs-io\.mjs/);
      assert.match(message(result), /Tell the user these commits change gate files\./);
    });

    it('keeps the warning when the saved verify state lets the stop pass at once', () => {
      setSessionBase(head());
      editGate();
      commit('agent commits a gate change');
      assert.equal(writeState().status, 0);
      const result = stop();
      assert.equal(result.status, 0, result.stderr);
      assert.match(message(result), /Tell the user these commits change gate files\./);
    });

    it('adds the warning to a block that has another cause', () => {
      setSessionBase(head());
      editGate();
      commit('agent commits a gate change');
      repository.write('packages/a/src/a.test.ts', `it${'.skip'}('x', () => {});\n`);
      const result = stop();
      assert.equal(result.status, 2, result.stdout);
      assert.match(result.stderr, /anti-skip/);
      assert.match(result.stderr, /Tell the user these commits change gate files\./);
    });

    it('warns in the quick run too', () => {
      setSessionBase(head());
      editGate();
      commit('agent commits a gate change');
      const result = stop({ args: ['--fast'] });
      assert.equal(result.status, 0, result.stderr);
      assert.match(message(result), /Tell the user these commits change gate files\./);
    });

    it('does not warn for commits that touch no gate file', () => {
      setSessionBase(head());
      repository.write('src/app.mjs', 'export const b = 2;\n');
      commit('plain');
      const result = stop();
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, '');
    });
  });

  describe('require-verify', () => {
    const pushCommands = [
      'git push origin feature',
      'gh pr create --fill',
      'gh pr new --fill',
      'gh -R o/r pr new --fill',
    ];

    it('blocks a push or a PR when a gate file is changed, with a passing verify', () => {
      editGate();
      assert.equal(writeState().status, 0);
      for (const command of pushCommands) {
        const result = check(command);
        assert.equal(result.status, 2, command);
        assert.match(result.stderr, /Gate changes are pushed by a human\./);
        assert.ok(result.stderr.includes(GATE), result.stderr);
      }
    });

    it('blocks first on the gate change when there is no verify state at all', () => {
      editGate();
      const result = check('git push');
      assert.equal(result.status, 2);
      assert.match(result.stderr, /Gate changes are pushed by a human\./);
    });

    it('blocks a commit that changed a gate file when origin/main does not exist (root commit range)', () => {
      editGate();
      commit('gate change');
      assert.equal(writeState().status, 0);
      for (const command of pushCommands) {
        const result = check(command);
        assert.equal(result.status, 2, command);
        assert.match(result.stderr, /Gate changes are pushed by a human\./);
        assert.match(result.stderr, /committed after the root commit/);
      }
    });

    it('allows a push after a plain commit and a passing verify', () => {
      repository.write('src/app.mjs', 'export const b = 2;\n');
      commit('plain');
      assert.equal(writeState().status, 0);
      for (const command of pushCommands) {
        assert.equal(check(command).status, 0, command);
      }
    });

    it('measures from origin/main when it exists', () => {
      const remote = path.join(
        path.dirname(repository.root),
        `${path.basename(repository.root)}-rv.git`,
      );
      try {
        assert.equal(exec('git', ['init', '-q', '--bare', remote]).status, 0);
        repository.git('remote', 'add', 'origin', remote);
        repository.git('push', '-q', 'origin', 'main');
        repository.git('checkout', '-q', '-b', 'feature');
        repository.write('src/app.mjs', 'export const b = 3;\n');
        commit('plain');
        assert.equal(writeState().status, 0);
        assert.equal(check('git push origin feature').status, 0);
        editGate();
        commit('gate change');
        assert.equal(writeState().status, 0);
        const result = check('git push origin feature');
        assert.equal(result.status, 2);
        assert.match(result.stderr, /committed after origin\/main/);
      } finally {
        fs.rmSync(remote, { recursive: true, force: true });
      }
    });

    it('does not read the command text for commands that are not a push or a PR', () => {
      editGate();
      for (const command of ['git status', 'git commit -m "x"', 'gh pr view 1']) {
        assert.equal(check(command).status, 0, command);
      }
    });
  });
});
