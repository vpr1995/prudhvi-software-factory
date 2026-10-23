import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { callHook, makeRepository } from './harness.js';

describe('post-bash', () => {
  let repository;

  beforeEach(() => {
    repository = makeRepository();
  });

  afterEach(() => repository.remove());

  const failure = (command, error = 'Exit code 1\nboom') =>
    callHook(
      'post-bash',
      { hookEventName: 'PostToolUseFailure', toolName: 'Bash', toolInput: { command }, error },
      { root: repository.root },
    );

  for (const command of [
    'node common/scripts/install-run-rush.js build',
    'pnpm test',
    'npx vitest run',
    'go test ./...',
    'pytest -q',
    'cdk synth',
  ]) {
    it(`adds the fix reminder when a check fails: ${command}`, () => {
      const result = failure(command);
      assert.equal(result.status, 0);
      const output = JSON.parse(result.stdout).hookSpecificOutput;
      assert.equal(output.hookEventName, 'PostToolUseFailure');
      assert.match(
        output.additionalContext,
        /Fix the cause\. Do not skip, delete, or weaken tests or rules/,
      );
    });
  }

  it('stays silent for other failing commands and for success', () => {
    assert.equal(failure('ls /nope').stdout, '');
    const ok = callHook(
      'post-bash',
      {
        hookEventName: 'PostToolUse',
        toolName: 'Bash',
        toolInput: { command: 'pnpm test' },
        toolResponse: { stdout: 'ok' },
      },
      { root: repository.root },
    );
    assert.equal(ok.stdout, '');
  });
});

describe('session-start and prompt-context', () => {
  let repository;

  beforeEach(() => {
    repository = makeRepository();
  });

  afterEach(() => repository.remove());

  it('prints branch, gate summary and the Rush rule, and saves the session base', () => {
    const result = callHook(
      'session-start',
      { hookEventName: 'SessionStart', source: 'startup' },
      { root: repository.root },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /branch main/);
    assert.match(result.stdout, /Gate files: \d+ patterns/);
    assert.match(result.stdout, /install-run-rush\.js/);
    assert.equal(
      repository.read('.claude/state/session-base').trim(),
      repository.git('rev-parse', 'HEAD').trim(),
    );
  });

  it('warns when common/temp is missing', () => {
    fs.rmSync(path.join(repository.root, 'common', 'temp'), { recursive: true });
    const result = callHook('session-start', { source: 'startup' }, { root: repository.root });
    assert.match(result.stdout, /SETUP: common\/temp is missing/);
  });

  it('keeps the saved base on resume and compact, and replaces it on startup and clear', () => {
    callHook('session-start', { source: 'startup' }, { root: repository.root });
    const first = repository.read('.claude/state/session-base');
    repository.write('packages/a/src/b.ts', 'export const b = 1;\n');
    repository.git('add', '-A');
    repository.git('commit', '-q', '-m', 'second');
    callHook('session-start', { source: 'resume' }, { root: repository.root });
    assert.equal(repository.read('.claude/state/session-base'), first);
    callHook('session-start', { source: 'compact' }, { root: repository.root });
    assert.equal(repository.read('.claude/state/session-base'), first);
    callHook('session-start', { source: 'clear' }, { root: repository.root });
    assert.notEqual(repository.read('.claude/state/session-base'), first);
  });

  const tier = (files) => {
    for (const [name, text] of Object.entries(files)) {
      repository.write(name, text);
    }
    const result = callHook(
      'prompt-context',
      { hookEventName: 'UserPromptSubmit' },
      { root: repository.root },
    );
    return JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
  };

  it('guesses a high tier for a gate file', () => {
    assert.match(tier({ 'tooling/x.js': 'x\n' }), /high \(gate file changed: tooling\/x\.js\)/);
  });

  it('guesses a high tier for platform, packages and infra paths', () => {
    assert.match(tier({ 'packages/a/src/b.ts': 'x\n' }), /high/);
  });

  it('guesses a low tier for docs and tests only', () => {
    assert.match(
      tier({ 'docs/a.md': 'x\n', 'projects/p/src/api/a.test.ts': 'x\n' }),
      /low \(only docs and tests changed\)/,
    );
  });

  it('guesses a medium tier for project source', () => {
    assert.match(tier({ 'projects/p/src/api/a.ts': 'x\n' }), /medium/);
  });
});
