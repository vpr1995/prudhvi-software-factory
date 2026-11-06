// Tests for the commit gate (scripts/lib/commit-gate.mjs) and its typecheck proof, in temp git repos.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { findGitCommits } from '../scripts/lib/commit-gate-command.mjs';
import { commitGate } from '../scripts/lib/commit-gate.mjs';
import { handle } from '../scripts/lib/stop-gate-core.mjs';

const RUSH = 'node common/scripts/install-run-rush.js';
const SCRIPT = path.resolve(import.meta.dirname, '../scripts/stop-gate.mjs');
const roots = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function write(root, file, text) {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
}

// Temp repo with projects @x/a (projects/a) and @x/b (packages/b).
function makeRepository() {
  const root = mkdtempSync(path.join(tmpdir(), 'commit-gate-'));
  roots.push(root);
  const files = {
    'rush.json': `{
  // Comment, as in the real rush.json.
  "projects": [
    { "packageName": "@x/a", "projectFolder": "projects/a" },
    { "packageName": "@x/b", "projectFolder": "packages/b" },
  ],
}`,
    'projects/a/package.json': '{"name":"@x/a","dependencies":{"@x/b":"workspace:*"}}',
    'packages/b/package.json': '{"name":"@x/b"}',
    'projects/a/src/a.ts': 'export const a = 1;\n',
    'packages/b/src/b.ts': 'export const b = 1;\n',
    '.gitignore': '.claude/state/\n',
  };
  for (const [file, text] of Object.entries(files)) write(root, file, text);
  git(root, 'init', '-q');
  git(root, 'add', '.');
  git(root, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
  return root;
}

function git(root, ...args) {
  execFileSync('git', args, { cwd: root, stdio: 'ignore' });
}

// Hook input in the snake_case form of Claude Code. Tests write camelCase keys (naming rule).
function hookJson(fields) {
  const convert = (value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key.replaceAll(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
        convert(item),
      ]),
    );
  };
  return JSON.stringify(convert(fields));
}

function bashInput(root, command, fields = {}) {
  return hookJson({
    sessionId: 's1',
    cwd: root,
    hookEventName: 'PreToolUse',
    toolName: 'Bash',
    toolUseId: 'toolu_c',
    toolInput: { command },
    ...fields,
  });
}

function gate(root, command, env = {}) {
  const output = commitGate(bashInput(root, command), { root, env });
  return output === undefined ? undefined : JSON.parse(output).hookSpecificOutput;
}

let callCount = 0;
// Runs the stop-gate Bash hooks around a passing command, as Claude Code does.
function passingRun(root, command) {
  callCount += 1;
  const shared = { toolUseId: `toolu_${String(callCount)}` };
  handle(bashInput(root, command, shared), { root, env: {} });
  const output = handle(
    bashInput(root, command, {
      ...shared,
      hookEventName: 'PostToolUse',
      toolResponse: { stdout: '', stderr: '' },
    }),
    { root, env: {} },
  );
  return output === undefined ? '' : JSON.parse(output).hookSpecificOutput.additionalContext;
}

const COMMIT = 'git commit -m "feat(a): x"';

test('a staged source file with no typecheck proof denies; a typecheck pass allows', () => {
  const root = makeRepository();
  write(root, 'projects/a/src/a.ts', 'export const a = 2;\n');
  git(root, 'add', '-A');
  const denied = gate(root, COMMIT);
  assert.equal(denied.hookEventName, 'PreToolUse');
  assert.equal(denied.permissionDecision, 'deny');
  assert.match(denied.permissionDecisionReason, /@x\/a: projects\/a\/src\/a\.ts/);
  assert.match(
    denied.permissionDecisionReason,
    /Run: node common\/scripts\/install-run-rush\.js typecheck --only @x\/a\n/,
  );
  assert.match(passingRun(root, `${RUSH} typecheck --only @x/a`), /typecheck proof recorded/);
  assert.equal(gate(root, COMMIT), undefined);
});

test('an edit after the typecheck denies again', () => {
  const root = makeRepository();
  write(root, 'projects/a/src/a.ts', 'export const a = 2;\n');
  passingRun(root, `${RUSH} typecheck --only @x/a`);
  write(root, 'projects/a/src/a.ts', 'export const a = 3;\n');
  git(root, 'add', '-A');
  assert.equal(gate(root, COMMIT).permissionDecision, 'deny');
});

test('a rush verify pass counts; a rush test pass alone does not', () => {
  const root = makeRepository();
  write(root, 'projects/a/src/a.ts', 'export const a = 2;\n');
  write(root, 'packages/b/src/b.ts', 'export const b = 2;\n');
  git(root, 'add', '-A');
  passingRun(root, `${RUSH} test`);
  const reason = gate(root, COMMIT).permissionDecisionReason;
  assert.match(reason, /typecheck --only @x\/b --only @x\/a\n/);
  passingRun(root, `${RUSH} verify --only @x/b`);
  assert.doesNotMatch(gate(root, COMMIT).permissionDecisionReason, /@x\/b/);
  passingRun(root, `${RUSH} verify`);
  assert.equal(gate(root, COMMIT), undefined);
});

test('a rush typecheck pass is no test proof for the verify gate', () => {
  const root = makeRepository();
  const input = (fields) => hookJson({ sessionId: 's1', cwd: root, ...fields });
  handle(
    input({
      hookEventName: 'PostToolUse',
      toolName: 'Write',
      agentId: 'w1',
      toolInput: { filePath: path.join(root, 'projects/a/src/a.ts') },
    }),
    { root, env: {} },
  );
  write(root, 'projects/a/src/a.ts', 'export const a = 2;\n');
  passingRun(root, `${RUSH} typecheck --only @x/a`);
  const stop = handle(input({ hookEventName: 'Stop', backgroundTasks: [] }), {
    root,
    env: {},
  });
  assert.equal(JSON.parse(stop ?? '{}').decision, 'block');
  // A failed typecheck does not let a subagent stop either.
  const failed = { toolUseId: 'toolu_f', agentId: 'w1' };
  handle(bashInput(root, `${RUSH} typecheck --only @x/a`, failed), { root, env: {} });
  handle(
    bashInput(root, `${RUSH} typecheck --only @x/a`, {
      ...failed,
      hookEventName: 'PostToolUseFailure',
    }),
    { root, env: {} },
  );
  const subagent = handle(
    input({ hookEventName: 'SubagentStop', agentId: 'w1', agentType: 'general-purpose' }),
    { root, env: {} },
  );
  assert.equal(JSON.parse(subagent ?? '{}').decision, 'block');
});

test('a piped typecheck gives no typecheck proof', () => {
  const root = makeRepository();
  write(root, 'projects/a/src/a.ts', 'export const a = 2;\n');
  git(root, 'add', '-A');
  const text = passingRun(root, `${RUSH} typecheck --only @x/a | tail`);
  assert.match(text, /no typecheck proof recorded/);
  assert.doesNotMatch(text, /no test proof/);
  assert.equal(gate(root, COMMIT).permissionDecision, 'deny');
});

test('doc-only commits and an amend with nothing staged allow', () => {
  const root = makeRepository();
  write(root, 'projects/a/src/a.ts', 'export const a = 2;\n'); // Not staged.
  assert.equal(gate(root, 'git commit --amend --no-edit'), undefined);
  write(root, 'projects/a/README.md', '# a\n');
  git(root, 'add', 'projects/a/README.md');
  assert.equal(gate(root, COMMIT), undefined);
});

test('a partly staged file denies with the staging message', () => {
  const root = makeRepository();
  write(root, 'projects/a/src/a.ts', 'export const a = 2;\n');
  git(root, 'add', '-A');
  write(root, 'projects/a/src/a.ts', 'export const a = 2;\nexport const c = 3;\n');
  passingRun(root, `${RUSH} typecheck --only @x/a`);
  const reason = gate(root, COMMIT).permissionDecisionReason;
  assert.match(reason, /Partly staged .*: projects\/a\/src\/a\.ts\./);
  assert.match(reason, /git stash --keep-index/);
  // Typecheck the staged content: the proof is by content hash, so the commit can go on.
  assert.match(reason, /git restore --source=stash@\{0\} --worktree -- \./);
  git(root, 'stash', '-q', '--keep-index');
  passingRun(root, `${RUSH} typecheck --only @x/a`);
  assert.equal(gate(root, COMMIT), undefined);
  git(root, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'x');
  git(root, 'restore', '--source=stash@{0}', '--worktree', '--', '.');
  git(root, 'stash', 'drop', '-q');
  const text = readFileSync(path.join(root, 'projects/a/src/a.ts'), 'utf8');
  assert.equal(text, 'export const a = 2;\nexport const c = 3;\n');
});

test('a staged source file outside each Rush project denies', () => {
  const root = makeRepository();
  write(root, 'tooling/loose/x.ts', 'export const x = 1;\n');
  git(root, 'add', '-A');
  const reason = gate(root, COMMIT).permissionDecisionReason;
  assert.match(
    reason,
    /No Rush project: tooling\/loose\/x\.ts\. Register the project in rush\.json/,
  );
  assert.doesNotMatch(reason, /Run: node/);
});

test('a command that can stage files before the commit denies', () => {
  const root = makeRepository();
  write(root, 'projects/a/src/a.ts', 'export const a = 2;\n'); // Not staged: the hook runs first.
  for (const command of [
    "git add -A && cat > /tmp/align/msg.txt <<'EOF'\nfeat: x\nEOF\ngit commit -q -F /tmp/align/msg.txt",
    'git add -A; git commit -m x',
    'git add -A\ngit commit -m x',
    'git rm -q x || git commit -m x',
    'git stash && git commit -m x',
    'node stage.mjs && git commit -m x',
    'git commit -m a && git commit -m b',
    'GIT_INDEX_FILE=/tmp/i git commit -m x',
  ]) {
    assert.match(
      gate(root, command)?.permissionDecisionReason ?? '',
      /Run git add in its own command, then git commit|variable "GIT_INDEX_FILE"/,
      command,
    );
  }
  for (const command of [
    'cd projects/a && git commit -m x',
    'git status && git diff --cached && git commit -m x',
    "cat > /tmp/m.txt <<'EOF'\nx\nEOF\ngit commit -F /tmp/m.txt",
    'echo x | git commit -F -',
    'git commit -m x && git add -A',
  ]) {
    assert.equal(gate(root, command), undefined, command);
  }
});

test('commit forms that commit work tree content deny', () => {
  const root = makeRepository();
  for (const command of [
    'git commit -am x',
    'git commit -a -m x',
    'git commit --all -m x',
    'git commit -m x projects/a/src/a.ts',
    'git commit -i -m x',
    'git commit -m x -- projects/a/src/a.ts',
    'git commit --pathspec-from-file=f -m x',
    'git commit -p',
  ]) {
    assert.match(gate(root, command)?.permissionDecisionReason ?? '', /Stage the files/, command);
  }
});

test('FACTORY_STOP_GATE=off allows', () => {
  const root = makeRepository();
  write(root, 'projects/a/src/a.ts', 'export const a = 2;\n');
  git(root, 'add', '-A');
  assert.equal(gate(root, COMMIT, { FACTORY_STOP_GATE: 'off' }), undefined);
});

test('a non-commit Bash command and a commit in another repo are untouched', () => {
  const root = makeRepository();
  write(root, 'projects/a/src/a.ts', 'export const a = 2;\n');
  git(root, 'add', '-A');
  for (const command of ['git status', 'git log --grep commit', 'echo "git commit"', 'ls']) {
    assert.equal(gate(root, command), undefined, command);
  }
  const other = makeRepository();
  assert.equal(gate(root, `git -C ${other} commit -m x`), undefined);
  assert.equal(gate(root, 'git -C projects/a commit -m x').permissionDecision, 'deny');
});

test('the script denies on malformed input only for a commit', () => {
  const run = (input) => spawnSync('node', [SCRIPT, 'commit'], { input, encoding: 'utf8' });
  const plain = run('not json');
  assert.equal(plain.status, 0);
  assert.equal(plain.stdout, '');
  const status = run('{"tool_input":{"command":"git status"');
  assert.equal(status.stdout, '');
  const commit = run('{"tool_input":{"command":"git commit -m x"');
  assert.equal(commit.status, 0);
  const output = JSON.parse(commit.stdout).hookSpecificOutput;
  assert.equal(output.permissionDecision, 'deny');
  assert.match(output.permissionDecisionReason, /Commit gate error: .*JSON/);
});

test('findGitCommits reads the commit forms', () => {
  const problems = (command) => findGitCommits(command).commits.map((commit) => commit.problem);
  assert.deepEqual(problems('git commit -m "a b"'), [undefined]);
  assert.deepEqual(problems('git commit -ma'), [undefined]);
  assert.deepEqual(problems('git commit -sm x --amend --no-edit -F -'), [undefined]);
  assert.deepEqual(problems('git add x && git -c a=b --no-pager commit --author "A <a@a>" -m x'), [
    undefined,
  ]);
  assert.deepEqual(problems('git commit -m x 2>&1 > out.txt'), [undefined]);
  assert.deepEqual(problems('git commit -am x'), ['option "-a"']);
  assert.deepEqual(problems('git --git-dir=/x commit -m x'), [
    'the gate does not follow "--git-dir=/x"',
  ]);
  assert.deepEqual(problems('git status; git log'), []);
  const heredoc = `git commit -m "$(cat <<'EOF'\nfeat(a): x\n\nCo-Authored-By: A <a@a>\nEOF\n)"`;
  assert.deepEqual(findGitCommits(heredoc), {
    commits: [{ directories: [], problem: undefined, before: undefined }],
    parsed: true,
  });
  assert.deepEqual(findGitCommits('git commit -m "$(date)"'), { commits: [], parsed: false });
  assert.deepEqual(findGitCommits('echo $(date)'), { commits: [], parsed: true });
  assert.deepEqual(findGitCommits('git -C a -C b commit').commits[0]?.directories, ['a', 'b']);
  // A heredoc body is data: git commit text in it is no commit.
  const script = `python3 - <<'EOF'\nprint("git commit (x)")\nEOF\n`;
  assert.deepEqual(findGitCommits(script), { commits: [], parsed: true });
  const fileMessage = `git commit -F - <<EOF\nfix(a): x\nEOF`;
  assert.deepEqual(findGitCommits(fileMessage).commits, [
    { directories: [], problem: undefined, before: undefined },
  ]);
  // An unparseable command with a git subcommand and the word commit-gate is no commit.
  assert.deepEqual(findGitCommits('ls $(git diff --name-only) commit-gate.mjs').parsed, true);
  assert.deepEqual(findGitCommits('cd $(mktemp -d) && git commit -m x').parsed, false);
});
