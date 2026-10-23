import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { cdkSynthCheck } from '../lib/stop-checks.mjs';

import { callHook, exec, makeRepository } from './harness.js';

const SKIP_CALL = ['it', '.skip', "('later', () => {});\n"].join('');

describe('stop-gate', () => {
  let repository;

  beforeEach(() => {
    repository = makeRepository();
  });

  afterEach(() => repository.remove());

  const stop = (active = false, args = []) =>
    callHook(
      'stop-gate',
      { hookEventName: 'Stop', stopHookActive: active },
      { root: repository.root, args },
    );
  const state = () => JSON.parse(repository.read('.claude/state/last-verify.json') ?? 'null');
  const rushCalls = () =>
    (repository.read('common/temp/stub-calls.log') ?? '').trim().split('\n').filter(Boolean);

  it('passes with no changes and records a passing state', () => {
    const result = stop();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(state().status, 'pass');
    assert.deepEqual(rushCalls(), []);
  });

  it('runs rush verify for the impacted project only (--from) and passes', () => {
    repository.write('packages/a/src/a.ts', 'export const value = 2;\n');
    const result = stop();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(rushCalls(), ['verify --from @t/a']);
    assert.deepEqual(state().impactedProjects, ['@t/a']);
  });

  it('exits at once when the last verify passed and nothing changed', () => {
    repository.write('packages/a/src/a.ts', 'export const value = 2;\n');
    assert.equal(stop().status, 0);
    const before = rushCalls().length;
    assert.equal(stop().status, 0);
    assert.equal(rushCalls().length, before, 'rush must not run again');
  });

  it('runs the checks again when the tree changed after a pass', () => {
    repository.write('packages/a/src/a.ts', 'export const value = 2;\n');
    assert.equal(stop().status, 0);
    repository.write('packages/a/src/a.ts', 'export const value = 3;\n');
    assert.equal(stop().status, 0);
    assert.equal(rushCalls().length, 2);
  });

  it('blocks with a numbered report when a rush operation fails', () => {
    repository.write('common/temp/stub-fail', '1');
    repository.write('packages/a/src/a.ts', 'export const value = 2;\n');
    const result = stop();
    assert.equal(result.status, 2);
    assert.match(result.stderr, /^STOP BLOCKED: 1 check failed\./);
    assert.match(result.stderr, /1\. lint: @t\/a/);
    assert.match(result.stderr, /stub lint failure/);
    assert.match(
      result.stderr,
      /Do not skip, delete, or weaken tests or rules\. Run the `verify` skill, then stop again\.\n?$/,
    );
    assert.equal(state().status, 'fail');
  });

  it('blocks when anti-skip finds a skipped test', () => {
    repository.write('packages/a/src/a.test.ts', `${SKIP_CALL}`);
    const result = stop();
    assert.equal(result.status, 2);
    assert.match(result.stderr, /1\. anti-skip/);
    assert.match(result.stderr, /packages\/a\/src\/a\.test\.ts:1:/);
  });

  it('reports every failed check', () => {
    repository.write('common/temp/stub-fail', '1');
    repository.write('packages/a/src/a.test.ts', SKIP_CALL);
    const result = stop();
    assert.equal(result.status, 2);
    assert.match(result.stderr, /STOP BLOCKED: 2 checks failed\./);
  });

  it('fails with a setup hint when rush is not installed', () => {
    repository.write('packages/a/src/a.ts', 'export const value = 2;\n');
    fs.rmSync(`${repository.root}/common/temp`, { recursive: true, force: true });
    const result = stop();
    assert.equal(result.status, 2);
    assert.match(result.stderr, /common\/temp is missing/);
    assert.match(result.stderr, /install-run-rush\.js install/);
  });

  it('stops blocking after three blocked stops, then passes with a warning', () => {
    repository.write('common/temp/stub-fail', '1');
    repository.write('packages/a/src/a.ts', 'export const value = 2;\n');
    const first = stop(false);
    assert.equal(first.status, 2);
    assert.ok(!first.stderr.includes('LAST RETRY'));
    assert.equal(stop(true).status, 2);
    const third = stop(true);
    assert.equal(third.status, 2);
    assert.match(third.stderr, /LAST RETRY/);
    const fourth = stop(true);
    assert.equal(fourth.status, 0);
    assert.match(JSON.parse(fourth.stdout).systemMessage, /3 stops were blocked/);
    assert.equal(repository.exists('.claude/state/stop-attempts'), false, 'the counter resets');
  });

  it('resets the counter when stop_hook_active is false', () => {
    repository.write('common/temp/stub-fail', '1');
    repository.write('packages/a/src/a.ts', 'export const value = 2;\n');
    assert.equal(stop(false).status, 2);
    assert.equal(stop(true).status, 2);
    assert.equal(stop(false).status, 2);
    assert.equal(repository.read('.claude/state/stop-attempts').trim(), '1');
  });

  it('passes after the cause is fixed and resets the counter', () => {
    repository.write('common/temp/stub-fail', '1');
    repository.write('packages/a/src/a.ts', 'export const value = 2;\n');
    assert.equal(stop(false).status, 2);
    fs.rmSync(`${repository.root}/common/temp/stub-fail`);
    const result = stop(true);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(repository.exists('.claude/state/stop-attempts'), false);
    assert.equal(state().status, 'pass');
  });

  it('prompt-context resets the counters', () => {
    repository.write('common/temp/stub-fail', '1');
    repository.write('packages/a/src/a.ts', 'export const value = 2;\n');
    stop(false);
    assert.equal(repository.exists('.claude/state/stop-attempts'), true);
    const result = callHook(
      'prompt-context',
      { hookEventName: 'UserPromptSubmit' },
      { root: repository.root },
    );
    assert.equal(result.status, 0);
    assert.equal(repository.exists('.claude/state/stop-attempts'), false);
    assert.match(JSON.parse(result.stdout).hookSpecificOutput.additionalContext, /Risk tier guess/);
  });

  describe('--write-state-only', () => {
    it('exits 0 and saves a pass state without reading stdin', () => {
      const result = callHook('stop-gate', null, {
        root: repository.root,
        args: ['--write-state-only'],
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(state().mode, 'write-state-only');
    });

    it('re-runs the checks and exits 1 on failure, ignoring the loop guard', () => {
      repository.write('common/temp/stub-fail', '1');
      repository.write('packages/a/src/a.ts', 'export const value = 2;\n');
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const result = callHook('stop-gate', null, {
          root: repository.root,
          args: ['--write-state-only'],
        });
        assert.equal(result.status, 1);
        assert.match(result.stderr, /STOP BLOCKED/);
      }
      assert.equal(state().status, 'fail');
    });
  });

  describe('--fast (SubagentStop)', () => {
    const fast = (active) =>
      callHook(
        'stop-gate',
        { hookEventName: 'SubagentStop', stopHookActive: active },
        { root: repository.root, args: ['--fast'] },
      );

    it('passes on a clean change and writes no state', () => {
      repository.write('packages/a/src/a.ts', 'export const value = 2;\n');
      assert.equal(fast(false).status, 0);
      assert.equal(repository.exists('.claude/state/last-verify.json'), false);
      assert.deepEqual(rushCalls(), []);
    });

    it('blocks on anti-skip, then lets the subagent stop on the second try', () => {
      repository.write('packages/a/src/a.test.ts', SKIP_CALL);
      assert.equal(fast(false).status, 2);
      const second = fast(true);
      assert.equal(second.status, 0);
      assert.match(JSON.parse(second.stdout).systemMessage, /Subagent stopped with failing checks/);
    });
  });
  describe('a required scanner that did not run', () => {
    // No opengrep on PATH and no user tool folders: the opengrep check skips and is degraded.
    let toolFolder;
    let scannerless;

    beforeEach(() => {
      toolFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-bin-'));
      fs.symlinkSync(process.execPath, path.join(toolFolder, 'node'));
      scannerless = { PATH: `${toolFolder}:/usr/bin:/bin`, HOME: toolFolder, CI: 'false' };
      // The rules file is a gate file. It sits in the first commit, as a human would put it there.
      repository.remove();
      repository = makeRepository({ 'tooling/opengrep/rules.yml': 'rules: []\n' });
      repository.write('packages/a/src/a.ts', 'export const value = 2;\n');
    });

    afterEach(() => fs.rmSync(toolFolder, { recursive: true, force: true }));

    const stopWithoutScanner = (active = false) =>
      callHook(
        'stop-gate',
        { hookEventName: 'Stop', stopHookActive: active },
        { root: repository.root, env: scannerless },
      );

    it('lets the stop pass, records pass-with-skips and does not run rush again', () => {
      const first = stopWithoutScanner();
      assert.equal(first.status, 0, first.stderr);
      assert.equal(state().status, 'pass-with-skips');
      assert.match(state().summary, /opengrep/);
      const calls = rushCalls().length;
      assert.equal(stopWithoutScanner().status, 0);
      assert.equal(rushCalls().length, calls, 'the saved pass-with-skips state is current');
    });

    it('tells --write-state-only to install the scanner', () => {
      const result = callHook('stop-gate', null, {
        root: repository.root,
        args: ['--write-state-only'],
        env: scannerless,
      });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /pass-with-skips/);
      assert.match(result.stdout, /required scanner did not run/);
    });

    it('is not accepted by require-verify before a push or a PR', () => {
      assert.equal(stopWithoutScanner().status, 0);
      const result = callHook(
        'require-verify',
        { hookEventName: 'PreToolUse', toolName: 'Bash', toolInput: { command: 'git push' } },
        { root: repository.root },
      );
      assert.equal(result.status, 2);
      assert.match(result.stderr, /skipped a required scanner/);
    });
  });

  describe('a crash inside the gate', () => {
    it('blocks the stop, bumps the loop counter and ends the loop after three tries', () => {
      repository.write('packages/a/src/a.ts', 'export const value = 2;\n');
      // A folder where the state file belongs makes the state write throw.
      fs.mkdirSync(`${repository.root}/.claude/state/last-verify.json`, { recursive: true });
      const first = stop(false);
      assert.equal(first.status, 2);
      assert.match(first.stderr, /STOP BLOCKED: the stop-gate could not finish its checks/);
      assert.equal(repository.read('.claude/state/stop-attempts').trim(), '1');
      assert.equal(stop(true).status, 2);
      const third = stop(true);
      assert.equal(third.status, 2);
      assert.match(third.stderr, /LAST RETRY/);
      assert.equal(stop(true).status, 0, 'the loop guard still ends a crash loop');
    });
  });

  describe('a crash while the saved verify state is checked', () => {
    // A pass state, then a change the hash step cannot read: verifyIsCurrent throws.
    const breakTheHashStep = () => {
      repository.write('packages/a/src/a.ts', 'export const value = 2;\n');
      assert.equal(stop(false).status, 0);
      assert.equal(state().status, 'pass');
      repository.write('packages/a/src/unreadable.ts', 'export const hidden = 1;\n');
      fs.chmodSync(`${repository.root}/packages/a/src/unreadable.ts`, 0o000);
    };

    it('blocks with a short message that names the cause, not a stack trace', () => {
      breakTheHashStep();
      const result = stop(false);
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, /STOP BLOCKED: the stop-gate could not finish its checks/);
      assert.match(result.stderr, /git .* failed|EACCES|permission denied/i);
      assert.doesNotMatch(result.stderr, /\n\s+at /, 'no stack trace');
      assert.ok(result.stderr.split('\n').length < 15, 'the message is short');
    });

    it('keeps the loop guard: the counter grows and the fourth stop passes', () => {
      breakTheHashStep();
      assert.equal(stop(false).status, 2);
      assert.equal(repository.read('.claude/state/stop-attempts')?.trim(), '1');
      assert.equal(stop(true).status, 2);
      const third = stop(true);
      assert.equal(third.status, 2);
      assert.match(third.stderr, /LAST RETRY/);
      const fourth = stop(true);
      assert.equal(fourth.status, 0, fourth.stderr);
      assert.match(JSON.parse(fourth.stdout).systemMessage, /3 stops were blocked/);
    });

    it('blocks with the git message when the index is corrupt after a pass', () => {
      repository.write('packages/a/src/a.ts', 'export const value = 2;\n');
      assert.equal(stop(false).status, 0);
      fs.writeFileSync(`${repository.root}/.git/index`, 'garbage');
      const result = stop(false);
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, /STOP BLOCKED: the stop-gate could not finish its checks/);
      assert.doesNotMatch(result.stderr, /\n\s+at /, 'no stack trace');
      assert.equal(repository.read('.claude/state/stop-attempts')?.trim(), '1');
    });
  });

  describe('the shell wrapper', () => {
    let fakeBin;

    beforeEach(() => {
      fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-fake-node-'));
    });

    afterEach(() => fs.rmSync(fakeBin, { recursive: true, force: true }));

    const withFakeNode = (script, args = []) => {
      fs.writeFileSync(path.join(fakeBin, 'node'), `#!/bin/sh\n${script}\n`, { mode: 0o755 });
      return callHook(
        'stop-gate',
        { hookEventName: 'Stop', stopHookActive: false },
        { root: repository.root, args, env: { PATH: `${fakeBin}:/usr/bin:/bin` } },
      );
    };

    it('exits 2 with a message when node exits with 1', () => {
      const result = withFakeNode('echo boom >&2; exit 1');
      assert.equal(result.status, 2);
      assert.match(result.stderr, /stop-gate: the gate crashed \(node exit code 1\)/);
    });

    it('exits 2 with a message when node dies on a signal', () => {
      const result = withFakeNode('kill -9 $$');
      assert.equal(result.status, 2);
      assert.match(result.stderr, /stop-gate: the gate crashed/);
    });

    it('passes exit 0 and exit 2 through', () => {
      assert.equal(withFakeNode('exit 0').status, 0);
      const blocked = withFakeNode('echo report >&2; exit 2');
      assert.equal(blocked.status, 2);
      assert.match(blocked.stderr, /report/);
      assert.doesNotMatch(blocked.stderr, /crashed/);
    });

    it('keeps exit 1 for --write-state-only, where it means the checks failed', () => {
      const result = withFakeNode('exit 1', ['--write-state-only']);
      assert.equal(result.status, 1);
    });
  });

  describe('a repository with no commit', () => {
    it('writes a state and does not crash', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-empty-'));
      try {
        exec('git', ['init', '-q', '-b', 'main'], { cwd: root });
        fs.mkdirSync(path.join(root, 'common', 'temp'), { recursive: true });
        fs.mkdirSync(path.join(root, 'common', 'scripts'), { recursive: true });
        fs.writeFileSync(
          path.join(root, 'common/scripts/install-run-rush.js'),
          "console.log('ok');\n",
        );
        fs.writeFileSync(path.join(root, 'rush.json'), '{"projects":[]}\n');
        fs.writeFileSync(path.join(root, '.gitignore'), 'common/temp/\n.claude/state/\n');
        const result = callHook('stop-gate', null, { root, args: ['--write-state-only'] });
        assert.equal(result.status, 0, result.stderr);
        const saved = JSON.parse(
          fs.readFileSync(path.join(root, '.claude/state/last-verify.json'), 'utf8'),
        );
        assert.notEqual(saved.status, 'fail');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  });
});

// The stub cdk logs one line for each call (cwd|args) to cdk-calls.log next to itself, which is in
// node_modules, so git ignores it. Like the real apps, it fails with "Got: undefined" when
// bin/app.ts reads the env context and the call has no -c env. It also fails for the env that the
// file fail-env next to it names.
const CDK_STUB = `#!/bin/sh
here="$(dirname "$0")"
printf '%s|%s\\n' "$PWD" "$*" >> "$here/cdk-calls.log"
case "$*" in
  *"-c env="*) ;;
  *)
    if grep -q "tryGetContext('env')" bin/app.ts 2>/dev/null; then
      echo "stub cdk: the env context must be a configs key. Got: undefined" >&2
      exit 1
    fi
    ;;
esac
fail="$(cat "$here/fail-env" 2>/dev/null)"
if [ -n "$fail" ]; then
  case "$*" in
    *"env=$fail"*) echo "stub cdk: synth error for env=$fail" >&2; exit 3 ;;
  esac
fi
exit 0
`;
const ENV_BIN = "const env = app.node.tryGetContext('env');\naddStack(app, env);\n";
const ENV_CONFIG = 'const configs = { local: localConfig, prod: productionConfig } as const;\n';

describe('stop-gate: cdk synth for each environment', () => {
  let repository;
  let appFolder;

  beforeEach(() => {
    repository = makeRepository();
    appFolder = path.join(repository.root, 'projects/app');
    repository.write('projects/app/node_modules/.bin/cdk', CDK_STUB);
    fs.chmodSync(path.join(appFolder, 'node_modules/.bin/cdk'), 0o755);
  });

  afterEach(() => repository.remove());

  /** @returns {string[][]} The stub calls, each split into cwd and args. */
  const cdkCalls = () =>
    (repository.read('projects/app/node_modules/.bin/cdk-calls.log') ?? '')
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split('|'));

  it('runs one synth for each key of the configs object, with -c env=<name>', () => {
    repository.write('projects/app/bin/app.ts', ENV_BIN);
    repository.write('projects/app/lib/config/config.ts', ENV_CONFIG);
    const check = cdkSynthCheck(repository.root, 'projects/app');
    assert.deepEqual(check, { name: 'cdk synth: projects/app', status: 'pass', detail: '' });
    assert.deepEqual(cdkCalls(), [
      [appFolder, 'synth --quiet -c env=local'],
      [appFolder, 'synth --quiet -c env=prod'],
    ]);
  });

  it('runs one synth with no -c env when bin does not read the env context', () => {
    repository.write('projects/app/bin/app.ts', 'new App().synth();\n');
    const check = cdkSynthCheck(repository.root, 'projects/app');
    assert.deepEqual(check, { name: 'cdk synth: projects/app', status: 'pass', detail: '' });
    assert.deepEqual(cdkCalls(), [[appFolder, 'synth --quiet']]);
  });

  it('fails with a clear message and runs no synth when bin reads env and configs is missing', () => {
    repository.write('projects/app/bin/app.ts', ENV_BIN);
    const check = cdkSynthCheck(repository.root, 'projects/app');
    assert.equal(check.name, 'cdk synth: projects/app');
    assert.equal(check.status, 'fail');
    assert.match(
      check.detail,
      /projects\/app\/bin reads the "env" context, but projects\/app\/lib\/config\/config\.ts has no "const configs = \{ <env>: \.\.\. \}" object/,
    );
    assert.match(check.detail, /environment names are unknown/);
    assert.deepEqual(cdkCalls(), []);
  });

  it('stops at the first env that fails and names that env', () => {
    repository.write('projects/app/bin/app.ts', ENV_BIN);
    repository.write('projects/app/lib/config/config.ts', ENV_CONFIG);
    repository.write('projects/app/node_modules/.bin/fail-env', 'local');
    const check = cdkSynthCheck(repository.root, 'projects/app');
    assert.equal(check.name, 'cdk synth: projects/app (env=local)');
    assert.equal(check.status, 'fail');
    assert.match(check.detail, /stub cdk: synth error for env=local/);
    assert.deepEqual(cdkCalls(), [[appFolder, 'synth --quiet -c env=local']]);
  });

  it('still skips, degraded, when the app has no local cdk', () => {
    fs.rmSync(path.join(appFolder, 'node_modules'), { recursive: true, force: true });
    repository.write('projects/app/bin/app.ts', ENV_BIN);
    const check = cdkSynthCheck(repository.root, 'projects/app');
    assert.equal(check.status, 'skip');
    assert.equal(check.degraded, true);
    assert.match(check.detail, /cdk is not installed in this folder/);
  });

  it('lets the Stop hook pass after an infra change in an app that reads the env context', () => {
    repository.write('projects/app/bin/app.ts', ENV_BIN);
    repository.write('projects/app/lib/config/config.ts', ENV_CONFIG);
    const result = callHook(
      'stop-gate',
      { hookEventName: 'Stop', stopHookActive: false },
      { root: repository.root },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      cdkCalls().map(([, args]) => args),
      ['synth --quiet -c env=local', 'synth --quiet -c env=prod'],
    );
  });
});
