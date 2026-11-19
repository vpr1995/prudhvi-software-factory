// Tests for the PreToolUse hook that asks the owner before a Bash write to a protected path
// (issue #146 part 2). Each test runs the script with hook input JSON on stdin.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { readRepositoryFile } from '../scripts/lib/fs-io.mjs';

import { pathFromEnv } from './test-env.config.js';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const SCRIPT = fileURLToPath(new URL('../scripts/protected-write-check.mjs', import.meta.url));
const SCRIPT_NAME = 'protected-write-check.mjs';
const TOOL_INPUT = 'tool_input';
const BASE_ENV = { PATH: pathFromEnv() };

const hookInput = (command) => JSON.stringify({ [TOOL_INPUT]: { command } });

const run = (input, env = BASE_ENV) =>
  spawnSync(process.execPath, [SCRIPT], { input, encoding: 'utf8', env });

const assertAsk = (result) => {
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout).hookSpecificOutput;
  assert.equal(output.hookEventName, 'PreToolUse');
  assert.equal(output.permissionDecision, 'ask');
  assert.match(output.permissionDecisionReason, /\S/u);
};

const assertSilent = (result) => {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
};

for (const command of [
  "sed -i '' s/a/b/ tooling/repo-checks/scripts/factory.mjs",
  'echo x > tooling/repo-checks/a.txt',
  'echo x >> .claude/settings.json',
  'echo {} >"/repo/.claude/settings.local.json"',
  'echo x | tee tooling/repo-checks/a.txt',
  'cp /tmp/a .claude/settings.json',
  'mv /tmp/a tooling/repo-checks/scripts/a.mjs',
  'rm -rf tooling/repo-checks',
  'git apply /tmp/patch -- tooling/repo-checks',
  'git apply /tmp/x.patch && cat .claude/settings.json',
  'git checkout -- .claude/settings.json',
  'git restore tooling/repo-checks/test/a.test.js',
  'sed -Ei s/a/b/ tooling/repo-checks/x',
  'git checkout HEAD~1 .claude/settings.json',
  'git -C . apply p tooling/repo-checks',
  'perl -pi -e s/a/b/ .claude/settings.json',
  'dd if=/tmp/a of=.claude/settings.json',
  'ln -sf /tmp/a .claude/settings.json',
  'rm TOOLING/Repo-Checks/x',
  'cp a .Claude/Settings.json',
  'rm tooling//repo-checks/x',
  'rm tooling/./repo-checks/x',
  'cat tooling/repo-checks/x | sh',
  'grep x tooling/repo-checks/a && rm tooling/repo-checks/a',
  'cat tooling/repo-checks/x & rm tooling/repo-checks/x',
  'node tooling/repo-checks/scripts/doc-lint.mjs 2>&1 | tail -5',
]) {
  test(`asks for a non-read on a protected path: ${command}`, () => {
    const result = run(hookInput(command));
    assertAsk(result);
    assert.match(
      JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason,
      /tooling\/repo-checks|\.claude\/settings/u,
    );
  });
}

for (const command of [
  'rm tooling/eslint-config/../repo-checks/x',
  'cp a .claude/x/../settings.json',
  'cat tooling/x/../repo-checks/y',
]) {
  test(`asks for a command with .. and a protected-path hint: ${command}`, () => {
    assertAsk(run(hookInput(command)));
  });
}

for (const command of [
  'cat ../README.md',
  'ls ..',
  'rm ../x',
  'git diff main..HEAD -- tooling/repo-checks',
]) {
  test(`gives no output for .. that is not a ../ path to tooling/ or .claude/: ${command}`, () => {
    assertSilent(run(hookInput(command)));
  });
}

for (const command of [
  'head tooling/repo-checks/x',
  'tail tooling/repo-checks/x',
  'rg x tooling/repo-checks',
  'ls tooling/repo-checks',
  'wc -l tooling/repo-checks/x',
  'diff tooling/repo-checks/a tooling/repo-checks/b',
  'stat tooling/repo-checks/x',
  'file tooling/repo-checks/x',
  'git show HEAD -- tooling/repo-checks',
  'git status tooling/repo-checks',
  'git blame tooling/repo-checks/x',
  'git commit -m msg tooling/repo-checks/x',
  'git grep x tooling/repo-checks',
  'node --test tooling/repo-checks/test/x.test.js',
  'node tooling/repo-checks/scripts/doc-lint.mjs',
  'cat tooling/repo-checks/scripts/factory.mjs',
  'grep -n x tooling/repo-checks/scripts/a.mjs',
  'grep x tooling/repo-checks/a 2>/dev/null',
  'git diff -- tooling/repo-checks .claude/settings.json',
  'git log --oneline -- tooling/repo-checks',
  'node tooling/repo-checks/scripts/factory.mjs next',
  'node tooling/repo-checks/scripts/factory.mjs route 146 2>&1',
  'node common/scripts/install-run-rush.js test --only @vprprudhvi/tooling-repo-checks',
  'node tooling/repo-checks/scripts/doc-lint.mjs 2>&1',
  'git add tooling/repo-checks/scripts/x.mjs',
]) {
  test(`gives no output for a read: ${command}`, () => {
    assertSilent(run(hookInput(command)));
  });
}

for (const command of ['sed -i s/a/b/ docs/x.md', 'echo x > /tmp/y', 'rm -rf /tmp/z']) {
  test(`gives no output for a write to another path: ${command}`, () => {
    assertSilent(run(hookInput(command)));
  });
}

for (const [name, input] of [
  ['bad JSON', '{not json'],
  ['empty input', ''],
  ['no command', JSON.stringify({ [TOOL_INPUT]: {} })],
]) {
  test(`asks for bad hook input (fail closed): ${name}`, () => {
    assertAsk(run(input));
  });
}

const hookEntry = () => {
  const settings = JSON.parse(readRepositoryFile(ROOT, '.claude/settings.json'));
  const hooks = settings.hooks.PreToolUse.filter((entry) => entry.matcher === 'Bash').flatMap(
    (entry) => entry.hooks,
  );
  return hooks.find((hook) => hook.command.includes(SCRIPT_NAME));
};
const HOOK = hookEntry();

const runSettingsHook = (input, env) =>
  spawnSync('sh', ['-c', HOOK.command], { input, encoding: 'utf8', env });

test('.claude/settings.json registers the hook on PreToolUse for Bash, not gated by FACTORY_STOP_GATE', () => {
  assert.ok(HOOK, `no PreToolUse Bash hook runs ${SCRIPT_NAME}`);
  assert.equal(HOOK.type, 'command');
  assert.doesNotMatch(HOOK.command, /FACTORY_STOP_GATE/u);
  assert.match(HOOK.command, /\|\| echo '/u);
});

test('the settings hook asks when node cannot run the script', () => {
  const env = { ...BASE_ENV, CLAUDE_PROJECT_DIR: '/nonexistent-project-dir' };
  assertAsk(runSettingsHook(hookInput('cat docs/x.md'), env));
});

test('FACTORY_STOP_GATE=off does not turn the hook off', () => {
  const env = { ...BASE_ENV, FACTORY_STOP_GATE: 'off', CLAUDE_PROJECT_DIR: ROOT };
  assertAsk(run(hookInput('rm tooling/repo-checks/a.mjs'), env));
  assertAsk(runSettingsHook(hookInput('rm tooling/repo-checks/a.mjs'), env));
});
