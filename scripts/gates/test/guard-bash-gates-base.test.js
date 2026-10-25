// guard-bash: an agent must not set GATES_BASE or write .claude/state/gates-base. Both choose the base
// commit of the gate checks (lib/gates-base.mjs), and a changed base hides changes from the dependency
// policy, anti-skip and check-gates (rule in lib/bash-rules-gates-base.mjs).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { checkGatesBase } from '../lib/bash-rules-gates-base.mjs';
import { parseShell } from '../lib/shell-parse.mjs';

import { bashCall, callHook, editCall, GATES, makeRepository } from './harness.js';

const BLOCKED = [
  // Environment: assignment, wrapper, declaration.
  ['assignment before a command', 'GATES_BASE=HEAD git status'],
  ['assignment before the gate runner', 'GATES_BASE=HEAD bash scripts/gates/local-gates.sh'],
  ['assignment with an empty value', 'GATES_BASE= git status'],
  ['append assignment', 'GATES_BASE+=x git status'],
  ['env wrapper', 'env GATES_BASE=HEAD git status'],
  ['env wrapper with a flag', 'env -i GATES_BASE=HEAD git status'],
  ['export', 'export GATES_BASE=HEAD'],
  ['export, then a command', 'export GATES_BASE=HEAD && git status'],
  ['export without a value', 'export GATES_BASE'],
  ['declare -x', 'declare -x GATES_BASE=HEAD'],
  ['readonly', 'readonly GATES_BASE=HEAD'],
  ['inside bash -c', 'bash -c "GATES_BASE=HEAD git status"'],
  ['inside bash -c with export', "sh -c 'export GATES_BASE=HEAD; git status'"],
  ['variable name from a variable', 'export ${N}=HEAD'],
  ['variable name from a substitution', 'export $(echo GATES_BASE=HEAD)'],
  // The state file: redirect and writers.
  ['redirect', 'echo HEAD > .claude/state/gates-base'],
  ['append redirect', 'echo HEAD >> .claude/state/gates-base'],
  ['redirect of git output', 'git rev-parse HEAD > .claude/state/gates-base'],
  ['redirect after cd', 'cd .claude/state && echo HEAD > gates-base'],
  ['tee', 'echo HEAD | tee .claude/state/gates-base'],
  ['cp', 'cp /tmp/x .claude/state/gates-base'],
  ['mv', 'mv /tmp/x .claude/state/gates-base'],
  ['dd of', 'dd if=/tmp/x of=.claude/state/gates-base'],
  ['sed in place', 'sed -i s/a/b/ .claude/state/gates-base'],
  ['touch', 'touch .claude/state/gates-base'],
  ['truncate', 'truncate -s 0 .claude/state/gates-base'],
  // Code of an interpreter or shell.
  ['node env', 'node -e "process.env.GATES_BASE=\'HEAD\'"'],
  ['node write', "node -e \"require('fs').writeFileSync('.claude/state/gates-base','x')\""],
  ['python env', "python3 -c \"import os;os.environ['GATES_BASE']='HEAD'\""],
  ['bash heredoc', "bash <<'EOF'\nexport GATES_BASE=HEAD\nEOF"],
  ['pipe into bash', 'echo "export GATES_BASE=HEAD" | bash'],
];

const ALLOWED = [
  ['read the state file', 'cat .claude/state/gates-base'],
  ['read the variable', 'echo $GATES_BASE'],
  ['search the name', 'grep -rn GATES_BASE scripts docs'],
  ['print the base', 'node scripts/gates/gates-base.mjs'],
  ['run the base test', 'node --test scripts/gates/test/gates-base.test.js'],
  ['copy from the state file', 'cp .claude/state/gates-base /tmp/gb'],
  ['read with sed', 'sed -n 1,5p .claude/state/gates-base'],
  ['read with dd', 'dd if=.claude/state/gates-base of=/tmp/gb'],
  ['other variable', 'GATES_FULL=1 echo ok'],
  ['other export', 'export NODE_ENV=test'],
  ['plain node code', 'node -e "console.log(1)"'],
  ['normal write', 'echo x > src/app.mjs'],
];

describe('guard-bash: GATES_BASE and the gates-base state file', () => {
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

  it('gives a reason that names the variable and the file', () => {
    const result = call('GATES_BASE=HEAD git status');
    assert.match(result.stdout + result.stderr, /GATES_BASE and \.claude\/state\/gates-base/);
  });
});

describe('the gates-base state file is a gate file (F5)', () => {
  it('has an entry in gate-files.json with a why line', () => {
    const { gates } = JSON.parse(fs.readFileSync(path.join(GATES, 'gate-files.json'), 'utf8'));
    const entry = gates.find((gate) => gate.glob === '.claude/state/gates-base');
    assert.ok(entry !== undefined, 'no gate entry for .claude/state/gates-base');
    assert.ok(entry.why.length > 20);
  });

  it('is refused by the edit hook for Write and Edit', () => {
    const repository = makeRepository({ 'src/app.mjs': 'export const b = 2;\n' });
    try {
      for (const tool of ['Write', 'Edit']) {
        const target = path.join(repository.root, '.claude/state/gates-base');
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

describe('checkGatesBase rule', () => {
  it('returns a reason for a set and null for a read', () => {
    assert.match(checkGatesBase(parseShell('GATES_BASE=x ls')) ?? '', /GATES_BASE/);
    assert.equal(checkGatesBase(parseShell('cat .claude/state/gates-base')), null);
    assert.equal(checkGatesBase(parseShell('ls')), null);
  });
});
