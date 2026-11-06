// Tests for scripts/stop-gate.mjs and its lib: record, proof, gate and deferral, in temp git repos.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { coveredProjects, findRushRuns } from '../scripts/lib/stop-gate-command.mjs';
import { handle } from '../scripts/lib/stop-gate-core.mjs';
import { isSourceFile } from '../scripts/lib/stop-gate-repo.mjs';
import { defer } from '../scripts/stop-gate.mjs';

import { withGlobalGitConfig } from './global-git.config.mjs';

const RUSH = 'node common/scripts/install-run-rush.js';
const SCRIPT = path.resolve(import.meta.dirname, '../scripts/stop-gate.mjs');
const roots = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

// Temp repo with projects @x/a (projects/a, depends on @x/b) and @x/b (packages/b).
function makeRepository() {
  const root = mkdtempSync(path.join(tmpdir(), 'stop-gate-'));
  roots.push(root);
  const files = {
    'rush.json': `{
  // Comment, as in the real rush.json.
  "projects": [
    { "packageName": "@x/a", "projectFolder": "projects/a" },
    { "packageName": "@x/b", "projectFolder": "packages/b" },
  ],
}`,
    'projects/a/package.json': '{"name":"@x/a","dependencies":{"@x/b":"workspace:*","zod":"1"}}',
    'packages/b/package.json': '{"name":"@x/b"}',
    'projects/a/src/a.ts': 'export const a = 1;\n',
    'packages/b/src/b.ts': 'export const b = 1;\n',
    '.gitignore': '.claude/state/\n',
  };
  for (const [file, text] of Object.entries(files)) write(root, file, text);
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  git('init', '-q');
  git('add', '.');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
  return root;
}

// Hook input in the snake_case form of Claude Code. Tests write camelCase keys (naming rule).
function hookJson(fields) {
  const convert = (value) => {
    if (Array.isArray(value)) return value.map((item) => convert(item));
    if (typeof value !== 'object' || value === null) return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key.replaceAll(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
        convert(item),
      ]),
    );
  };
  return JSON.stringify(convert(fields));
}

function commit(root) {
  execFileSync('git', ['add', '-A'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'x'], {
    cwd: root,
    stdio: 'ignore',
  });
}

function write(root, file, text) {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
}

function makeSession(root, env = {}) {
  const base = { sessionId: 's1', cwd: root };
  let callCount = 0;
  const call = (input) => {
    const output = handle(hookJson({ ...base, ...input }), { root, env });
    return output === undefined ? undefined : JSON.parse(output);
  };
  return {
    edit(file, text, agent) {
      write(root, file, text);
      return call({
        hookEventName: 'PostToolUse',
        toolName: 'Write',
        agentId: agent,
        toolInput: { filePath: path.join(root, file), content: text },
      });
    },
    // Runs the Bash hooks around `effect`, which stands for the command and can change files.
    bash(command, { agent, stdout = '', effect = () => {}, failed = false } = {}) {
      callCount += 1;
      const shared = { toolName: 'Bash', agentId: agent, toolUseId: `toolu_${String(callCount)}` };
      call({ ...shared, hookEventName: 'PreToolUse', toolInput: { command } });
      effect();
      if (failed) {
        return call({
          ...shared,
          hookEventName: 'PostToolUseFailure',
          toolInput: { command },
          error: 'Exit code 1',
        });
      }
      return call({
        ...shared,
        hookEventName: 'PostToolUse',
        toolInput: { command },
        toolResponse: { stdout, stderr: '' },
      });
    },
    stop(extra = {}) {
      return call({
        hookEventName: 'Stop',
        stopHookActive: false,
        backgroundTasks: [],
        ...extra,
      });
    },
    subagentStop(agent) {
      return call({
        hookEventName: 'SubagentStop',
        agentId: agent,
        agentType: 'general-purpose',
      });
    },
  };
}

test('edit blocks, a passing test run allows, a new edit blocks again', () => {
  const root = makeRepository();
  const s = makeSession(root);
  assert.equal(s.stop(), undefined);
  s.edit('projects/a/src/a.ts', 'export const a = 2;\n');
  const blocked = s.stop();
  assert.equal(blocked.decision, 'block');
  assert.match(blocked.reason, /@x\/a: projects\/a\/src\/a\.ts/);
  assert.match(blocked.reason, /install-run-rush\.js test --only @x\/a\n/);
  assert.match(blocked.reason, /defer/);
  const proof = s.bash(`${RUSH} test --only @x/a`);
  assert.match(proof.hookSpecificOutput.additionalContext, /1 changed files in @x\/a/);
  assert.equal(s.stop(), undefined);
  s.edit('projects/a/src/a.ts', 'export const a = 3;\n');
  assert.equal(s.stop().decision, 'block');
});

test('a failed run never reaches PostToolUse, so the stop stays blocked', () => {
  const root = makeRepository();
  const s = makeSession(root);
  s.edit('projects/a/src/a.ts', 'export const a = 2;\n');
  // Claude Code fires PostToolUseFailure, not PostToolUse, so no proof is recorded.
  assert.equal(s.bash(`${RUSH} test --only @x/a`, { failed: true }), undefined);
  assert.equal(s.stop().decision, 'block');
});

test('SubagentStop checks only its own files; main Stop checks all files', () => {
  const root = makeRepository();
  const s = makeSession(root);
  s.edit('projects/a/src/a.ts', 'export const a = 2;\n', 'agent1');
  s.edit('packages/b/src/b.ts', 'export const b = 2;\n', 'agent2');
  s.bash(`${RUSH} test --only @x/b`, { agent: 'agent2' });
  assert.equal(s.subagentStop('agent2'), undefined);
  const first = s.subagentStop('agent1');
  assert.equal(first.decision, 'block');
  assert.match(first.reason, /stop and report the failing check in your final message/);
  assert.match(first.reason, /Deferral is for the main session only/);
  assert.doesNotMatch(first.reason, /packages\/b/);
  const main = s.stop();
  assert.match(main.reason, /projects\/a\/src\/a\.ts/);
  assert.equal(s.subagentStop('internal'), undefined);
});

test('a background or interrupted Rush run gives no proof', () => {
  const root = makeRepository();
  const s = makeSession(root);
  s.edit('projects/a/src/a.ts', 'export const a = 2;\n');
  const background = handle(
    hookJson({
      sessionId: 's1',
      hookEventName: 'PostToolUse',
      toolName: 'Bash',
      toolUseId: 'toolu_direct',
      toolInput: { command: `${RUSH} test --only @x/a`, runInBackground: true },
      toolResponse: { stdout: '' },
    }),
    { root, env: {} },
  );
  assert.match(background, /background or was interrupted/);
  handle(
    hookJson({
      sessionId: 's1',
      hookEventName: 'PostToolUse',
      toolName: 'Bash',
      toolUseId: 'toolu_direct',
      toolInput: { command: `${RUSH} test --only @x/a` },
      toolResponse: { stdout: '', interrupted: true },
    }),
    { root, env: {} },
  );
  assert.equal(s.stop().decision, 'block');
});

test('SubagentStop with no agent_id (an internal agent) allows', () => {
  const root = makeRepository();
  const s = makeSession(root);
  s.edit('projects/a/src/a.ts', 'export const a = 2;\n');
  const output = handle(
    hookJson({ sessionId: 's1', hookEventName: 'SubagentStop', agentType: '' }),
    {
      root,
      env: {},
    },
  );
  assert.equal(output, undefined);
});

test('a file that a Bash command changes is recorded and blocks the stop', () => {
  const root = makeRepository();
  const s = makeSession(root);
  s.bash("sed -i '' 's/1/2/' projects/a/src/a.ts", {
    effect: () => write(root, 'projects/a/src/a.ts', 'export const a = 2;\n'),
  });
  s.bash('cat <<EOF > packages/b/src/new.ts', {
    agent: 'agent1',
    effect: () => write(root, 'packages/b/src/new.ts', 'export const n = 1;\n'),
  });
  assert.match(s.stop().reason, /projects\/a\/src\/a\.ts/);
  assert.doesNotMatch(s.subagentStop('agent1').reason, /projects\/a/);
  assert.match(s.subagentStop('agent1').reason, /packages\/b\/src\/new\.ts/);
  assert.equal(readdirSync(path.join(root, '.claude/state/gate/s1/bash')).length, 0);
});

test('a failed Bash command that wrote a file is recorded', () => {
  const root = makeRepository();
  const s = makeSession(root);
  s.bash('node gen.mjs && false', {
    effect: () => write(root, 'projects/a/src/gen.ts', 'export const g = 1;\n'),
    failed: true,
  });
  assert.match(s.stop().reason, /projects\/a\/src\/gen\.ts/);
});

test('a read-only Bash command records nothing', () => {
  const root = makeRepository();
  const s = makeSession(root);
  write(root, 'projects/a/src/a.ts', 'export const a = 9;\n'); // Changed before the session.
  s.bash('cat projects/a/src/a.ts && git status');
  assert.equal(s.stop(), undefined);
  assert.equal(existsSync(path.join(root, '.claude/state/gate/s1/agents/main.jsonl')), false);
});

test('a committed edit still blocks; a test run after the commit allows', () => {
  const root = makeRepository();
  const s = makeSession(root);
  s.edit('projects/a/src/a.ts', 'export const a = 2;\n');
  commit(root);
  assert.equal(s.stop().decision, 'block');
  s.bash(`${RUSH} test --only @x/a`);
  assert.equal(s.stop(), undefined);
});

test('a stashed edit (content back to the session base) allows', () => {
  const root = makeRepository();
  const s = makeSession(root);
  s.edit('projects/a/src/a.ts', 'export const a = 2;\n');
  execFileSync('git', ['stash', '-q'], { cwd: root, stdio: 'ignore' });
  assert.equal(s.stop(), undefined);
});

test('an unknown selector form gives no credit', () => {
  for (const selector of [
    '-t=@x/a',
    '-t@x/a',
    '--to-version-policy x',
    '--from-version-policy x',
  ]) {
    const { runs, rejected } = findRushRuns(`${RUSH} test ${selector}`);
    assert.deepEqual(runs, [], selector);
    assert.match(rejected.join(), /unknown selector/);
  }
  const root = makeRepository();
  const s = makeSession(root);
  s.edit('projects/a/src/a.ts', 'export const a = 2;\n');
  s.bash(`${RUSH} test -t=@x/a`);
  assert.equal(s.stop().decision, 'block');
});

test('a file that changes during the test command gets no credit', () => {
  const root = makeRepository();
  const s = makeSession(root);
  s.edit('projects/a/src/a.ts', 'export const a = 2;\n');
  s.bash(`${RUSH} test --only @x/a && echo x > projects/a/src/a.ts`, {
    effect: () => write(root, 'projects/a/src/a.ts', 'x\n'),
  });
  assert.equal(s.stop().decision, 'block');
  s.bash(`${RUSH} test --only @x/a`, {
    effect: () => {
      write(root, 'projects/a/src/a.ts', 'export const a = 4;\n');
      write(root, 'projects/a/src/new.ts', 'export const n = 1;\n');
    },
  });
  const reason = s.stop().reason;
  assert.match(reason, /projects\/a\/src\/a\.ts/);
  assert.match(reason, /projects\/a\/src\/new\.ts/);
});

test('a comment hides the rest of the line', () => {
  assert.deepEqual(findRushRuns(`true # ; ${RUSH} test`).runs, []);
  const root = makeRepository();
  const s = makeSession(root);
  s.edit('projects/a/src/a.ts', 'export const a = 2;\n');
  s.bash(`true # ; ${RUSH} test`);
  assert.equal(s.stop().decision, 'block');
  assert.deepEqual(findRushRuns(`${RUSH} test --only a#b`).runs, [
    { command: 'test', selectors: [{ kind: 'only', value: 'a#b' }] },
  ]);
});

test('a subagent can stop after a failed test run that covers its files', () => {
  const root = makeRepository();
  const s = makeSession(root);
  s.edit('projects/a/src/a.ts', 'export const a = 2;\n', 'agent1');
  s.bash(`false && ${RUSH} test --only @x/a`, { agent: 'agent1', failed: true });
  assert.equal(s.subagentStop('agent1').decision, 'block');
  s.bash(`${RUSH} test --only @x/b`, { agent: 'agent1', failed: true });
  assert.equal(s.subagentStop('agent1').decision, 'block');
  s.bash(`${RUSH} test --only @x/a`, { agent: 'agent1', failed: true });
  assert.deepEqual(s.subagentStop('agent1'), {
    systemMessage: `Subagent stopped with failing check: ${RUSH} test --only @x/a (projects: @x/a)`,
  });
  assert.equal(s.subagentStop('agent2'), undefined);
  assert.equal(s.stop().decision, 'block');
  s.edit('projects/a/src/a.ts', 'export const a = 3;\n', 'agent1');
  assert.equal(s.subagentStop('agent1').decision, 'block');
});

test('a source file outside each Rush project blocks', () => {
  const root = makeRepository();
  const s = makeSession(root);
  s.edit('tooling/loose/x.ts', 'export const x = 1;\n');
  const reason = s.stop().reason;
  assert.match(
    reason,
    /No Rush project: tooling\/loose\/x\.ts\. Register the project in rush\.json/,
  );
  assert.doesNotMatch(reason, /Run: node/);
});

test('.mts, .cts and .jsx files are source files', () => {
  const root = makeRepository();
  const s = makeSession(root);
  s.edit('projects/a/src/a.mts', 'export const a = 1;\n');
  assert.match(s.stop().reason, /projects\/a\/src\/a\.mts/);
});

test('the global excludes file of the user does not hide a Bash edit', () => {
  const root = makeRepository();
  write(root, 'global-ignore', 'new.ts\n');
  write(root, 'global-gitconfig', `[core]\n\texcludesFile = ${path.join(root, 'global-ignore')}\n`);
  const s = makeSession(root);
  const reason = withGlobalGitConfig(path.join(root, 'global-gitconfig'), () => {
    s.bash('cat <<EOF > projects/a/src/new.ts', {
      effect: () => write(root, 'projects/a/src/new.ts', 'export const n = 1;\n'),
    });
    return s.stop()?.reason;
  });
  assert.match(reason ?? '', /projects\/a\/src\/new\.ts/);
});

test('doc-only edits and files outside the repo allow', () => {
  const root = makeRepository();
  const s = makeSession(root);
  s.edit('projects/a/README.md', '# a\n');
  assert.equal(s.stop(), undefined);
  handle(
    hookJson({
      sessionId: 's1',
      hookEventName: 'PostToolUse',
      toolName: 'Edit',
      toolInput: { filePath: '/tmp/elsewhere/x.ts' },
    }),
    { root, env: {} },
  );
  assert.equal(s.stop(), undefined);
});

test('a reverted edit allows', () => {
  const root = makeRepository();
  const s = makeSession(root);
  s.edit('projects/a/src/a.ts', 'export const a = 2;\n');
  s.edit('projects/a/src/a.ts', 'export const a = 1;\n');
  assert.equal(s.stop(), undefined);
});

test('--only covers one project; no selector and --to cover the dependencies', () => {
  const root = makeRepository();
  const s = makeSession(root);
  s.edit('projects/a/src/a.ts', 'export const a = 2;\n');
  s.edit('packages/b/src/b.ts', 'export const b = 2;\n');
  s.bash(`${RUSH} test --only @x/a`);
  assert.match(s.stop().reason, /@x\/b/);
  assert.doesNotMatch(s.stop().reason, /@x\/a:/);
  s.bash('rush test');
  assert.equal(s.stop(), undefined);

  const other = makeSession(makeRepository());
  other.edit('packages/b/src/b.ts', 'export const b = 2;\n');
  other.bash(`${RUSH} verify --to @x/a`);
  assert.equal(other.stop(), undefined);
});

test('compound command with cd counts; a pipe or || does not', () => {
  const root = makeRepository();
  const s = makeSession(root);
  s.edit('projects/a/src/a.ts', 'export const a = 2;\n');
  const piped = s.bash(`${RUSH} test --only @x/a 2>&1 | tail -20`);
  assert.match(piped.hookSpecificOutput.additionalContext, /no test proof recorded/);
  s.bash(`${RUSH} test --only @x/a || true`);
  assert.equal(s.stop().decision, 'block');
  s.bash(`cd projects/a && ${RUSH} test --only @x/a`);
  assert.equal(s.stop(), undefined);
});

test('deferral from main allows with a system message and logs; a new edit blocks again', () => {
  const root = makeRepository();
  const s = makeSession(root);
  s.edit('projects/a/src/a.ts', 'export const a = 2;\n');
  const command = 'node tooling/repo-checks/scripts/stop-gate.mjs defer "ask owner"';
  s.bash(command, { stdout: defer(['ask owner']).text });
  assert.deepEqual(s.stop(), { systemMessage: 'Verify deferred: ask owner (projects: @x/a)' });
  const log = readFileSync(path.join(root, '.claude/state/deferrals.log'), 'utf8');
  assert.match(log, /\ts1\task owner\t@x\/a\n$/);
  s.edit('projects/a/src/a.ts', 'export const a = 3;\n');
  assert.equal(s.stop().decision, 'block');
});

test('deferral from a subagent records nothing', () => {
  const root = makeRepository();
  const s = makeSession(root);
  s.edit('projects/a/src/a.ts', 'export const a = 2;\n');
  const command = 'node tooling/repo-checks/scripts/stop-gate.mjs defer "x"';
  const output = s.bash(command, { agent: 'agent1', stdout: defer(['x']).text });
  assert.match(output.hookSpecificOutput.additionalContext, /main session only/);
  assert.equal(s.stop().decision, 'block');
});

test('a running subagent allows the main Stop only for the files it edited', () => {
  const root = makeRepository();
  const s = makeSession(root);
  s.edit('projects/a/src/a.ts', 'export const a = 2;\n', 'w1');
  const running = [{ id: 'w1', type: 'subagent', status: 'running' }];
  assert.equal(s.stop({ backgroundTasks: running }), undefined);
  const shell = [{ id: 'w1', type: 'shell', status: 'running' }];
  assert.equal(s.stop({ backgroundTasks: shell }).decision, 'block');
  const other = [{ id: 'w2', type: 'subagent', status: 'running' }];
  assert.equal(s.stop({ backgroundTasks: other }).decision, 'block');
  s.edit('packages/b/src/b.ts', 'export const b = 2;\n');
  const reason = s.stop({ backgroundTasks: running }).reason;
  assert.match(reason, /packages\/b\/src\/b\.ts/);
});

test('FACTORY_STOP_GATE=off allows', () => {
  const root = makeRepository();
  makeSession(root).edit('projects/a/src/a.ts', 'export const a = 2;\n');
  assert.equal(makeSession(root, { FACTORY_STOP_GATE: 'off' }).stop(), undefined);
});

test('a failed state hook makes the gate block', () => {
  const root = makeRepository();
  const s = makeSession(root);
  assert.throws(() =>
    handle(
      hookJson({
        sessionId: 's1',
        hookEventName: 'PostToolUse',
        toolName: 'Write',
        toolInput: {},
      }),
      { root, env: {} },
    ),
  );
  const reason = s.stop().reason;
  assert.match(reason, /state hook failed/);
  assert.match(reason, /report this error to the owner/);
  assert.doesNotMatch(reason, /delete/);
});

test('the script blocks with the error on malformed input', () => {
  const result = spawnSync('node', [SCRIPT], { input: 'not json', encoding: 'utf8' });
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.decision, 'block');
  assert.match(output.reason, /Verify gate error: .*JSON/);
});

test('snapshot mode never blocks, also on malformed input', () => {
  const result = spawnSync('node', [SCRIPT, 'snapshot'], { input: 'not json', encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
});

test('the defer command prints the reason and needs one', () => {
  const ok = spawnSync('node', [SCRIPT, 'defer', 'ask', 'owner'], { encoding: 'utf8' });
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /^stop-gate: deferral requested: ask owner\n/);
  assert.equal(spawnSync('node', [SCRIPT, 'defer'], { encoding: 'utf8' }).status, 1);
});

test('findRushRuns reads the command forms', () => {
  const kinds = (command) => findRushRuns(command).runs.map((run) => run.selectors);
  assert.deepEqual(kinds(`${RUSH} test --only @x/a -t @x/b --to-except=@x/c`), [
    [
      { kind: 'only', value: '@x/a' },
      { kind: 'to', value: '@x/b' },
      { kind: 'to-except', value: '@x/c' },
    ],
  ]);
  assert.deepEqual(kinds(`FOO=1 rush verify`), [[]]);
  assert.deepEqual(kinds(`FOO=1 rush verify && echo ok`), []);
  assert.deepEqual(kinds(`${RUSH} build --only @x/a`), []);
  assert.deepEqual(kinds(`${RUSH} test --help`), []);
  assert.deepEqual(kinds(`echo "rush test"`), []);
  assert.deepEqual(kinds(`false || ${RUSH} test`), []);
  assert.deepEqual(kinds(`${RUSH} test; echo done`), []);
  assert.deepEqual(kinds(`${RUSH} test &`), []);
  assert.deepEqual(kinds(`${RUSH} test > out.log 2>&1`), [[]]);
  assert.deepEqual(kinds(`$(echo rush) test`), []);
});

test('coveredProjects follows the dependency graph', () => {
  const projects = [
    { packageName: 'a', projectFolder: 'p/a', dependencies: ['b'] },
    { packageName: 'b', projectFolder: 'p/b', dependencies: ['c'] },
    { packageName: 'c', projectFolder: 'p/c', dependencies: [] },
    { packageName: 'd', projectFolder: 'p/d', dependencies: ['b'] },
  ];
  const cover = (kind, value) => [...coveredProjects(projects, [{ kind, value }])].toSorted();
  assert.deepEqual(cover('only', 'b'), ['b']);
  assert.deepEqual(cover('to', 'a'), ['a', 'b', 'c']);
  assert.deepEqual(cover('to-except', 'a'), ['b', 'c']);
  assert.deepEqual(cover('impacted-by', 'b'), ['a', 'b', 'd']);
  assert.deepEqual(cover('impacted-by-except', 'b'), ['a', 'd']);
  assert.deepEqual(cover('from', 'd'), ['b', 'c', 'd']);
  assert.deepEqual(cover('only', 'tag:x'), []);
  assert.deepEqual([...coveredProjects(projects, [])].length, 4);
});

test('isSourceFile', () => {
  assert.ok(isSourceFile('projects/a/src/a.ts'));
  assert.ok(isSourceFile('tooling/x/y.mjs'));
  assert.ok(!isSourceFile('docs/a.ts'));
  assert.ok(!isSourceFile('projects/a/README.md'));
  assert.ok(!isSourceFile('projects/a/dist/a.js'));
  assert.ok(isSourceFile('projects/a/src/a.mts'));
  assert.ok(isSourceFile('projects/a/src/a.cts'));
  assert.ok(isSourceFile('projects/a/src/a.jsx'));
});
