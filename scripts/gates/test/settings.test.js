import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { exec, GATES, REPOSITORY } from './harness.js';

const gateFiles = JSON.parse(fs.readFileSync(path.join(GATES, 'gate-files.json'), 'utf8'));
const pending = JSON.parse(
  fs.readFileSync(path.join(REPOSITORY, '.claude', 'settings.pending.json'), 'utf8'),
);

describe('settings.pending.json', () => {
  it('is in sync with gate-files.json (build-settings --check)', () => {
    const result = exec('node', [
      path.join(GATES, 'build-settings.mjs'),
      '--check',
      '--root',
      REPOSITORY,
    ]);
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  });

  it('has a deny rule for every gate glob', () => {
    for (const gate of gateFiles.gates) {
      const expected =
        gate.glob.includes('/') && !gate.glob.startsWith('**/')
          ? `Edit(/${gate.glob})`
          : `Edit(**/${gate.glob.replace(/^\*\*\//, '')})`;
      assert.ok(pending.permissions.deny.includes(expected), `missing deny rule ${expected}`);
    }
  });

  it('denies reading env files and AWS credentials', () => {
    for (const rule of ['Read(**/.env)', 'Read(**/.env.*)', 'Read(~/.aws/**)']) {
      assert.ok(pending.permissions.deny.includes(rule), rule);
    }
  });

  it('allows Rush through the wrapper only, and no package manager', () => {
    const allow = pending.permissions.allow.join('\n');
    assert.match(allow, /Bash\(node common\/scripts\/install-run-rush\.js:\*\)/);
    assert.doesNotMatch(allow, /\b(?:npm|pnpm|yarn)\b/);
  });

  it('wires every hook event with an existing, executable script', () => {
    const events = [
      'SessionStart',
      'UserPromptSubmit',
      'PreToolUse',
      'PostToolUse',
      'PostToolUseFailure',
      'Stop',
      'SubagentStop',
    ];
    for (const event of events) {
      assert.ok(Array.isArray(pending.hooks[event]) && pending.hooks[event].length > 0, event);
    }
    const commands = Object.values(pending.hooks).flatMap((groups) =>
      groups.flatMap((group) => group.hooks),
    );
    assert.ok(commands.length >= 12);
    for (const entry of commands) {
      assert.equal(entry.type, 'command');
      assert.ok(entry.timeout > 0, entry.command);
      const script = /\.claude\/hooks\/([\w-]+\.sh)/.exec(entry.command)?.[1];
      assert.ok(script, entry.command);
      const file = path.join(REPOSITORY, '.claude', 'hooks', script);
      assert.ok(fs.existsSync(file), `${script} is missing`);
      assert.ok(fs.statSync(file).mode & 0o111, `${script} is not executable`);
    }
  });

  it('runs the gate hooks before the tool and the format hooks after it', () => {
    const pre = pending.hooks.PreToolUse.flatMap((group) =>
      group.hooks.map((entry) => entry.command),
    ).join('\n');
    assert.match(pre, /protect-gates/);
    assert.match(pre, /block-secrets/);
    assert.match(pre, /guard-bash/);
    assert.match(pre, /require-verify/);
    const post = pending.hooks.PostToolUse.flatMap((group) =>
      group.hooks.map((entry) => entry.command),
    ).join('\n');
    assert.match(post, /post-edit/);
    assert.match(post, /typecheck-project/);
    assert.match(post, /post-bash/);
  });

  it('runs stop-gate for Stop and SubagentStop --fast', () => {
    assert.match(pending.hooks.Stop[0].hooks[0].command, /stop-gate\.sh$/);
    assert.match(pending.hooks.SubagentStop[0].hooks[0].command, /stop-gate\.sh --fast$/);
  });
});
