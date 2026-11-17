// Tests for the stack logic of scripts/factory.mjs (design factory-daily-run 4.1, 4.5; R-36 to
// R-42, R-6, R-55): `stack plan`, `next` (blocker wait, closed parent), `stage` (stack in ticket
// state), `route` and `push` (stack base), `restack`, and the run report. `gh` is a stub over a
// small world. Git is real in the restack, route and push tests: temp repos with a local bare
// remote. No test calls the real gh or the network.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { main, run as runProcess } from '../scripts/factory.mjs';
import { writeAtomic } from '../scripts/lib/fs-io.mjs';

import { pathFromEnv } from './test-env.config.js';

const STATE = '.claude/factory';
const OWNER = 'vpr1995';
const REPO = 'vpr1995/projects-monorepo';
const NOW = new Date('2026-11-17T10:00:00Z');
const OLD_RUN = 'old-run';
// GitHub names this field in snake case. A computed key keeps the naming rule quiet.
const CREATED = 'created_at';
const SUMMARY = 'sub_issues_summary';
const PASS = [{ name: 'ci', state: 'SUCCESS', bucket: 'pass' }];
const PENDING = [{ name: 'ci', state: 'PENDING', bucket: 'pending' }];
const FAIL = [{ name: 'ci', state: 'FAILURE', bucket: 'fail' }];
const roots = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const temporaryFolder = () => {
  const root = mkdtempSync(path.join(tmpdir(), 'factory-stack-'));
  roots.push(root);
  return root;
};

// The gh stub

const body = `### Context\n\nPaths: \`docs/guides/x.md\`\n\n### Acceptance\n\n- [ ] R-1: a thing\n\n### Notes\n\nSize: 2\n`;
const readyEvent = {
  event: 'labeled',
  label: { name: 'agent:ready' },
  actor: { login: OWNER },
  [CREATED]: '2026-11-10T08:00:00Z',
};
const makeIssue = (number, extra = {}) => ({
  number,
  state: 'OPEN',
  body,
  labels: ['agent:ready'],
  blockedBy: [],
  ...extra,
});
const makeBlocker = (number, extra = {}) => ({ number, state: 'open', labels: [], ...extra });
const makePr = (number, extra = {}) => ({
  number,
  headRefName: `feat/${String(number)}-x`,
  baseRefName: 'main',
  body: `Closes #${String(extra.closes ?? 7)}`,
  labels: [],
  author: { login: OWNER },
  isCrossRepository: false,
  ...extra,
});

const BOARD_FIELDS = {
  fields: [{ id: 'F', name: 'Status', options: [{ id: 'o1', name: 'In progress' }] }],
};

function answerIssue(world, args) {
  if (args[1] === 'list') {
    const label = args[args.indexOf('--label') + 1];
    const open = [...world.issues.values()].filter((issue) => issue.labels.includes(label));
    return JSON.stringify(open.map((issue) => ({ number: issue.number })));
  }
  const issue = world.issues.get(Number(args[2]));
  if (issue === undefined) return '';
  return JSON.stringify({
    state: issue.state,
    title: `ticket ${String(issue.number)}`,
    body: issue.body,
    labels: issue.labels.map((name) => ({ name })),
    author: { login: OWNER },
  });
}

function answerApi(world, args) {
  if (/\/(?:comments|reviews)$/.test(args[1])) return '[[]]';
  const [number, ...rest] = args[1].split('/issues/')[1].split('/');
  const issue = world.issues.get(Number(number));
  const suffix = rest.join('/');
  if (suffix === 'events') return JSON.stringify([[readyEvent]]);
  if (suffix === 'dependencies/blocked_by') return JSON.stringify(issue?.blockedBy ?? []);
  return JSON.stringify({ [SUMMARY]: { total: 0 } });
}

function answerPr(world, args) {
  const [, second] = args;
  if (second === 'list') {
    return JSON.stringify(
      args.includes('--head') ? (world.branchPrs.get(args[3]) ?? []) : world.openPrs,
    );
  }
  if (second === 'checks') return JSON.stringify(world.checks.get(Number(args[2])) ?? []);
  if (second === 'view') return JSON.stringify({ state: world.prState.get(Number(args[2])) });
  return '';
}

function answer(world, args) {
  const [first, second] = args;
  if (first === 'repo') {
    return args.includes('-q')
      ? `${REPO}\n`
      : JSON.stringify({ nameWithOwner: REPO, owner: { login: OWNER } });
  }
  if (first === 'project' && second === 'item-list') {
    const items = world.board.map((number) => ({
      id: `I_${String(number)}`,
      content: { number, type: 'Issue', repository: REPO },
      status: 'Ready',
    }));
    return JSON.stringify({ items });
  }
  if (first === 'project' && second === 'field-list') return JSON.stringify(BOARD_FIELDS);
  if (first === 'project' && second === 'view') return JSON.stringify({ id: 'P1' });
  if (first === 'issue') return answerIssue(world, args);
  if (first === 'api') return answerApi(world, args);
  if (first === 'pr') return answerPr(world, args);
  return '';
}

const READ_CALLS = new Set([
  'repo view',
  'project item-list',
  'project field-list',
  'project view',
  'issue list',
  'issue view',
  'pr list',
  'pr checks',
  'pr view',
]);
const isRead = (args) => args[0] === 'api' || READ_CALLS.has(args.slice(0, 2).join(' '));

/** A world with ticket 7 (blocker, no label) and ticket 8 (ready, blocked by #7, PR 70 for #7). */
function makeWorld({ blockers = [makeBlocker(7)], prs = [makePr(70)], checks = PASS } = {}) {
  const world = {
    board: [8],
    issues: new Map([
      [7, makeIssue(7, { labels: [] })],
      [8, makeIssue(8, { blockedBy: blockers })],
    ]),
    openPrs: prs,
    branchPrs: new Map(),
    checks: new Map(prs.map((pr) => [pr.number, checks])),
    prState: new Map(),
  };
  const calls = [];
  const gh = (args) => {
    calls.push(args);
    return answer(world, args);
  };
  return { world, gh, calls };
}

const writeCalls = (calls) => calls.filter((args) => !isRead(args));

/** Runs the CLI in process. The stubs keep the real environment out. */
function factory(argv, { root, gh, ...overrides }) {
  const out = [];
  const errors = [];
  const code = main(['node', 'factory.mjs', ...argv], {
    root,
    gh,
    runOff: () => false,
    now: () => NOW,
    pid: process.pid + 1_000_000,
    stdin: () => '',
    sessionId: () => '',
    git: () => 'feat/8-x\n',
    guard: () => {
      throw new Error('the local test guard must not run');
    },
    ...overrides,
    print: (text) => out.push(text),
    err: (text) => errors.push(text),
  });
  return { code, out: out.join(''), errors: errors.join('') };
}

const stateFile = (root, ...parts) => path.join(root, STATE, ...parts);
const readJson = (root, ...parts) => JSON.parse(readFileSync(stateFile(root, ...parts), 'utf8'));
const runLog = (root, runId = OLD_RUN) =>
  readFileSync(stateFile(root, 'runs', `${runId}.jsonl`), 'utf8')
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line));

const seedTicket = (root, ticket, extra = {}) =>
  writeAtomic(
    stateFile(root, String(ticket), 'ticket.json'),
    JSON.stringify({
      issue: ticket,
      stage: 'building',
      branch: `feat/${String(ticket)}-x`,
      base: null,
      pr: null,
      stackedOn: null,
      restartedAt: null,
      resumes: 0,
      ...extra,
    }),
  );
const seedRun = (root, extra = {}) =>
  writeAtomic(
    stateFile(root, 'run.json'),
    JSON.stringify({
      runId: OLD_RUN,
      sessionId: null,
      sessionIds: [],
      active: true,
      stalled: false,
      startedAt: '2026-11-16T08:00:00Z',
      only: null,
      next: null,
      waiting: null,
      stopChecks: { count: 0, lastHash: null },
      ...extra,
    }),
  );

// stack plan: R-36, R-42, R-41, R-6

test('R-36: the plan stacks on a blocker with an open PR, green CI and no needs-human, and names the base', () => {
  const root = temporaryFolder();
  const { gh, calls } = makeWorld();
  const result = factory(['stack', 'plan', '8'], { root, gh });
  assert.equal(result.code, 0, result.errors);
  assert.match(
    result.out,
    /^#8: stack on #7 \(PR #70, branch feat\/70-x, depth 2\)\. base: feat\/70-x$/m,
  );
  assert.deepEqual(writeCalls(calls), []);
  assert.equal(existsSync(stateFile(root)), false, 'the plan writes no state');
});

test('R-36: a ticket with no open blocker is not stacked and has the base main', () => {
  const root = temporaryFolder();
  const { gh } = makeWorld({ blockers: [] });
  const result = factory(['stack', 'plan', '8'], { root, gh });
  assert.equal(result.code, 0, result.errors);
  assert.match(result.out, /^#8: not stacked\. base: main$/m);
});

test('R-36: a plan of depth 3 is refused', () => {
  const root = temporaryFolder();
  const { gh } = makeWorld({
    prs: [makePr(70, { baseRefName: 'feat/60-x' }), makePr(60, { closes: 5 })],
  });
  const result = factory(['stack', 'plan', '8'], { root, gh });
  assert.equal(result.code, 0, result.errors);
  assert.match(result.out, /^#8: skip: blocked by #7: stack depth 3 is over 2/m);
  assert.doesNotMatch(result.out, /base: feat/);
});

test('R-6: a red blocker CI skips the ticket', () => {
  const root = temporaryFolder();
  const { gh } = makeWorld({ checks: FAIL });
  const result = factory(['stack', 'plan', '8'], { root, gh });
  assert.equal(result.code, 0, result.errors);
  assert.match(result.out, /^#8: skip: blocked by #7: CI of PR #70 is not green/m);
});

test('R-42: a pending blocker CI makes the plan wait for that PR', () => {
  const root = temporaryFolder();
  const { gh } = makeWorld({ checks: PENDING });
  const result = factory(['stack', 'plan', '8'], { root, gh });
  assert.equal(result.code, 0, result.errors);
  assert.match(result.out, /^#8: wait for the CI of PR #70$/m);
});

test('R-41: a stacked ticket whose blocker PR closed with no merge gives a hard stop', () => {
  const root = temporaryFolder();
  const { gh, world } = makeWorld();
  seedTicket(root, 8, { base: 'feat/70-x', stackedOn: 70 });
  world.prState.set(70, 'CLOSED');
  const result = factory(['stack', 'plan', '8'], { root, gh });
  assert.equal(result.code, 3);
  assert.match(result.errors, /^hard stop: .*PR #70 closed with no merge/);
});

test('R-36: the plan of a stacked ticket names its stored base and the state of the blocker PR', () => {
  const root = temporaryFolder();
  const { gh, world } = makeWorld();
  seedTicket(root, 8, { base: 'feat/70-x', stackedOn: 70 });
  world.prState.set(70, 'OPEN');
  assert.match(
    factory(['stack', 'plan', '8'], { root, gh }).out,
    /stacked on PR #70 \(OPEN\)\. base: feat\/70-x/,
  );
  seedTicket(root, 8, { base: null, stackedOn: 70 });
  world.prState.set(70, 'MERGED');
  assert.match(
    factory(['stack', 'plan', '8'], { root, gh }).out,
    /stacked on PR #70 \(MERGED\)\. base: main/,
  );
});

test('stack: bad arguments exit 2 with a usage line', () => {
  for (const words of [
    ['stack'],
    ['stack', 'plan'],
    ['stack', 'plan', 'x'],
    ['stack', 'go', '8'],
  ]) {
    const root = temporaryFolder();
    const { gh, calls } = makeWorld();
    const result = factory(words, { root, gh });
    assert.equal(result.code, 2, words.join(' '));
    assert.match(result.errors, /stack/);
    assert.deepEqual(calls, []);
  }
});

// next: R-42, R-41, R-6

test('R-42: next gives a wait step for a blocker PR whose CI runs, and logs no skip', () => {
  const root = temporaryFolder();
  const { gh } = makeWorld({ checks: PENDING });
  seedRun(root);
  const result = factory(['next'], { root, gh });
  assert.equal(result.code, 0, result.errors);
  assert.match(result.out, /next: wait for the CI of PR #70/);
  assert.deepEqual(readJson(root, 'run.json').next, { kind: 'wait', pr: 70 });
  const log = existsSync(stateFile(root, 'runs', `${OLD_RUN}.jsonl`)) ? runLog(root) : [];
  assert.deepEqual(
    log.filter((line) => line.event === 'skip'),
    [],
  );
});

test('R-42 then R-6: when the blocker CI ends red, next skips the ticket and ends the run', () => {
  const root = temporaryFolder();
  const { gh, world } = makeWorld({ checks: PENDING });
  seedRun(root);
  assert.match(factory(['next'], { root, gh }).out, /next: wait/);
  world.checks.set(70, FAIL);
  const result = factory(['next'], { root, gh });
  assert.match(result.out, /next: done/);
  assert.ok(runLog(root).some((line) => line.event === 'skip' && line.ticket === 8));
});

test('R-42 then R-36: when the blocker CI ends green, next starts the ticket stacked', () => {
  const root = temporaryFolder();
  const { gh, world } = makeWorld({ checks: PENDING });
  seedRun(root);
  assert.match(factory(['next'], { root, gh }).out, /next: wait/);
  world.checks.set(70, PASS);
  const result = factory(['next'], { root, gh });
  assert.match(result.out, /next: start #8, stacked on #7 \(PR #70, branch feat\/70-x\)/);
});

test('R-42: a ticket that can start comes before the wait for a pending blocker', () => {
  const root = temporaryFolder();
  const { gh, world } = makeWorld({ checks: PENDING });
  world.issues.set(9, makeIssue(9));
  world.board = [8, 9];
  seedRun(root);
  const result = factory(['next'], { root, gh });
  assert.match(result.out, /next: start #9\b/);
});

test('R-41: next gives a hard stop when the blocker PR of a stacked ticket closed with no merge', () => {
  const root = temporaryFolder();
  const { gh, world } = makeWorld();
  world.issues.set(8, makeIssue(8, { labels: ['agent:in-progress'] }));
  seedTicket(root, 8, { base: 'feat/70-x', stackedOn: 70 });
  world.prState.set(70, 'CLOSED');
  seedRun(root);
  const result = factory(['next'], { root, gh });
  assert.equal(result.code, 3);
  assert.match(result.errors, /^hard stop: .*PR #70 closed with no merge/);
});

// R-37: the stack in the ticket state

test('R-37: the stack of the next step reaches ticket.json when the ticket gets its state', () => {
  const root = temporaryFolder();
  const { gh } = makeWorld();
  seedRun(root);
  assert.match(factory(['next'], { root, gh }).out, /next: start #8, stacked on #7/);
  const staged = factory(['stage', '8', 'building'], { root, gh });
  assert.equal(staged.code, 0, staged.errors);
  const ticket = readJson(root, '8', 'ticket.json');
  assert.equal(ticket.base, 'feat/70-x');
  assert.equal(ticket.stackedOn, 70);
  assert.equal(ticket.branch, 'feat/8-x');
});

test('R-37: a ticket that is not the stacked next step gets no stack in its state', () => {
  const root = temporaryFolder();
  const { gh } = makeWorld();
  seedRun(root, {
    next: { kind: 'ticket', ticket: 9, resume: false, stack: { blocker: 7, pr: 70, branch: 'b' } },
  });
  assert.equal(factory(['stage', '8', 'building'], { root, gh }).code, 0);
  const ticket = readJson(root, '8', 'ticket.json');
  assert.equal(ticket.base, null);
  assert.equal(ticket.stackedOn, null);
});

// Real git: a stack main <- feat/92-x <- feat/90-x

const GIT_ENV = {
  PATH: pathFromEnv(),
  HOME: tmpdir(),
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
};

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
}

function commitFile(cwd, name, text) {
  mkdirSync(path.dirname(path.join(cwd, name)), { recursive: true });
  writeFileSync(path.join(cwd, name), text);
  git(cwd, 'add', name);
  git(cwd, 'commit', '-qm', `add ${name}`);
}

/** Work repo on feat/90-x, on feat/92-x, on main. All three are pushed to a bare remote. */
function buildTemplate() {
  const folder = temporaryFolder();
  const remote = path.join(folder, 'remote.git');
  const work = path.join(folder, 'work');
  git(folder, 'init', '-q', '--bare', '-b', 'main', remote);
  git(folder, 'init', '-q', '-b', 'main', work);
  git(work, 'config', 'commit.gpgsign', 'false');
  git(work, 'config', 'core.hooksPath', '/dev/null');
  git(work, 'config', 'user.name', 't');
  git(work, 'config', 'user.email', 't@t');
  git(work, 'remote', 'add', 'origin', remote);
  commitFile(work, 'README.md', 'hello\n');
  commitFile(work, 'src/a.js', 'export const a = 0;\n');
  git(work, 'push', '-q', 'origin', 'main');
  git(work, 'checkout', '-q', '-b', 'feat/92-x');
  commitFile(work, 'src/b.js', 'export const b = 1;\n');
  git(work, 'push', '-q', 'origin', 'feat/92-x');
  git(work, 'checkout', '-q', '-b', 'feat/90-x');
  commitFile(work, 'src/c.js', 'export const c = 2;\n');
  git(work, 'push', '-q', 'origin', 'feat/90-x');
  return folder;
}

let template;

function makeRepository() {
  template ??= buildTemplate();
  const folder = temporaryFolder();
  cpSync(template, folder, { recursive: true });
  const remote = path.join(folder, 'remote.git');
  const work = path.join(folder, 'work');
  git(work, 'remote', 'set-url', 'origin', remote);
  return { folder, remote, work };
}

/** Commits a file on a branch of the remote through a second clone. */
function advanceRemote({ folder, remote }, branch, name) {
  const other = path.join(folder, `other-${branch.replaceAll('/', '-')}`);
  git(folder, 'clone', '-q', remote, other);
  git(other, 'config', 'commit.gpgsign', 'false');
  git(other, 'config', 'core.hooksPath', '/dev/null');
  git(other, 'checkout', '-q', branch);
  commitFile(other, name, `export const x = "${name}";\n`);
  git(other, 'push', '-q', 'origin', branch);
}

/** The `git` of the command context: runs in the work repo and records each call. */
function recordingGit(work) {
  const calls = [];
  const exec = (args) => {
    calls.push(args);
    return runProcess('git', ['-C', work, ...args], 120_000);
  };
  return { exec, calls };
}

// R-37: base of route and push

const ROUTE_GH = (args) => (args[0] === 'issue' ? JSON.stringify({ body: 'Size: 2' }) : '');

test('R-37: route of a stacked ticket diffs against origin/<base>, not origin/main', () => {
  const { work } = makeRepository();
  const root = work;
  seedTicket(root, 90, { base: 'feat/92-x', stackedOn: 92, branch: 'feat/90-x' });
  const stacked = factory(['route', '90'], { root, gh: ROUTE_GH, git: recordingGit(work).exec });
  assert.equal(stacked.code, 0, stacked.errors);
  const result = JSON.parse(stacked.out);
  assert.equal(result.base, 'origin/feat/92-x');
  assert.equal(result.changedLines, 1, 'only the commit of the child branch counts');
});

test('R-37: route of a ticket that is not stacked keeps origin/main', () => {
  const { work } = makeRepository();
  seedTicket(work, 90, { base: null, branch: 'feat/90-x' });
  const result = JSON.parse(
    factory(['route', '90'], { root: work, gh: ROUTE_GH, git: recordingGit(work).exec }).out,
  );
  assert.equal(result.base, 'origin/main');
  assert.equal(result.changedLines, 2, 'both commits are on main');
});

test('R-37: an explicit --base wins over the stack base', () => {
  const { work } = makeRepository();
  seedTicket(work, 90, { base: 'feat/92-x', branch: 'feat/90-x' });
  const argv = ['route', '90', '--base', 'origin/feat/92-x~0'];
  const result = JSON.parse(
    factory(argv, { root: work, gh: ROUTE_GH, git: recordingGit(work).exec }).out,
  );
  assert.equal(result.base, 'origin/feat/92-x~0');
});

test('R-37: the local test guard of push runs against origin/<base> of a stacked ticket', () => {
  const { work } = makeRepository();
  seedTicket(work, 90, { base: 'feat/92-x', stackedOn: 92, branch: 'feat/90-x' });
  const bases = [];
  const guard = (base) => {
    bases.push(base);
    return [];
  };
  const result = factory(['push', '90'], {
    root: work,
    gh: () => '',
    git: recordingGit(work).exec,
    guard,
  });
  assert.equal(result.code, 0, result.errors);
  assert.deepEqual(bases, ['origin/feat/92-x']);
});

// restack: R-38, R-39, R-41, R-55

function restackWorld({
  parent,
  childPr = { number: 96, state: 'OPEN', isDraft: true, baseRefName: 'feat/92-x' },
}) {
  const harness = makeWorld();
  harness.world.prState.set(92, parent);
  harness.world.branchPrs.set('feat/90-x', [childPr]);
  return harness;
}

const STACKED = { base: 'feat/92-x', stackedOn: 92, branch: 'feat/90-x', stage: 'green' };
const FORBIDDEN_GIT = /^(?:rebase|reset|checkout|switch)$|^--force|^-f$|^\+|force/;

function assertNoRewrite(gitCalls) {
  for (const args of gitCalls) {
    assert.doesNotMatch(args.join(' '), FORBIDDEN_GIT, `git ${args.join(' ')} rewrites history`);
    assert.notEqual(args[0], 'rebase');
  }
}

test('R-38: restack merges the base branch into the branch, pushes it, and asks for verify', () => {
  const repository = makeRepository();
  const { work } = repository;
  advanceRemote(repository, 'feat/92-x', 'src/d.js');
  seedTicket(work, 90, STACKED);
  const { gh, calls } = restackWorld({ parent: 'OPEN' });
  const { exec, calls: gitCalls } = recordingGit(work);
  const bases = [];
  const guard = (base) => {
    bases.push(base);
    return [];
  };
  const result = factory(['restack', '90'], { root: work, gh, git: exec, guard });
  assert.equal(result.code, 0, result.errors);
  const parents = git(work, 'rev-list', '--parents', '-n', '1', 'HEAD').trim().split(' ');
  assert.equal(parents.length, 3, 'HEAD is a merge commit');
  assert.ok(existsSync(path.join(work, 'src/d.js')), 'the base change is in the branch');
  assert.equal(git(work, 'rev-parse', 'HEAD'), git(work, 'rev-parse', 'origin/feat/90-x'));
  assertNoRewrite(gitCalls);
  assert.ok(gitCalls.some((args) => args[0] === 'merge' && !args.includes('--rebase')));
  assert.deepEqual(bases, ['origin/feat/92-x']);
  assert.match(result.out, /run verify/i);
  assert.deepEqual(writeCalls(calls), [], 'the parent is open: the PR stays a draft');
  assert.equal(readJson(work, '90', 'ticket.json').base, 'feat/92-x');
});

test('R-39: after the parent merged, restack merges main, pushes, and marks the PR ready', () => {
  const repository = makeRepository();
  const { work } = repository;
  advanceRemote(repository, 'main', 'src/e.js');
  seedTicket(work, 90, STACKED);
  const { gh, calls } = restackWorld({
    parent: 'MERGED',
    childPr: { number: 96, state: 'OPEN', isDraft: true, baseRefName: 'main' },
  });
  const { exec, calls: gitCalls } = recordingGit(work);
  const bases = [];
  const guard = (base) => {
    bases.push(base);
    return [];
  };
  const result = factory(['restack', '90'], { root: work, gh, git: exec, guard });
  assert.equal(result.code, 0, result.errors);
  assert.ok(existsSync(path.join(work, 'src/e.js')), 'main is merged into the branch');
  assert.equal(git(work, 'rev-list', '--parents', '-n', '1', 'HEAD').trim().split(' ').length, 3);
  assert.equal(git(work, 'rev-parse', 'HEAD'), git(work, 'rev-parse', 'origin/feat/90-x'));
  assertNoRewrite(gitCalls);
  assert.deepEqual(bases, ['origin/main'], 'the guard uses main now');
  assert.deepEqual(writeCalls(calls), [['pr', 'ready', '96']]);
  const ticket = readJson(work, '90', 'ticket.json');
  assert.equal(ticket.base, null, 'the stack is over');
  assert.equal(ticket.stackedOn, 92, 'the stack is kept for the metrics');
});

test('R-39: restack retargets a PR that is not on main yet, then marks it ready', () => {
  const repository = makeRepository();
  const { work } = repository;
  seedTicket(work, 90, STACKED);
  const { gh, calls } = restackWorld({ parent: 'MERGED' });
  const result = factory(['restack', '90'], {
    root: work,
    gh,
    git: recordingGit(work).exec,
    guard: () => [],
  });
  assert.equal(result.code, 0, result.errors);
  assert.deepEqual(writeCalls(calls), [
    ['pr', 'edit', '96', '--base', 'main'],
    ['pr', 'ready', '96'],
  ]);
});

test('R-39: a PR that is ready already gets no ready call', () => {
  const repository = makeRepository();
  const { work } = repository;
  seedTicket(work, 90, STACKED);
  const { gh, calls } = restackWorld({
    parent: 'MERGED',
    childPr: { number: 96, state: 'OPEN', isDraft: false, baseRefName: 'main' },
  });
  const result = factory(['restack', '90'], {
    root: work,
    gh,
    git: recordingGit(work).exec,
    guard: () => [],
  });
  assert.equal(result.code, 0, result.errors);
  assert.deepEqual(writeCalls(calls), []);
});

test('R-41: restack gives a hard stop when the blocker PR closed with no merge, and merges nothing', () => {
  const { work } = makeRepository();
  seedTicket(work, 90, STACKED);
  const { gh } = restackWorld({ parent: 'CLOSED' });
  const { exec, calls: gitCalls } = recordingGit(work);
  const result = factory(['restack', '90'], { root: work, gh, git: exec, guard: () => [] });
  assert.equal(result.code, 3);
  assert.match(result.errors, /^hard stop: .*PR #92 closed with no merge/);
  assert.ok(!gitCalls.some((args) => args[0] === 'merge'));
});

test('R-55: a merge conflict in restack aborts the merge, exits 3, and lists the paths', () => {
  const repository = makeRepository();
  const { work } = repository;
  advanceRemote(repository, 'feat/92-x', 'src/c.js');
  seedTicket(work, 90, STACKED);
  const { gh } = restackWorld({ parent: 'OPEN' });
  const result = factory(['restack', '90'], {
    root: work,
    gh,
    git: recordingGit(work).exec,
    guard: () => [],
  });
  assert.equal(result.code, 3);
  assert.match(result.errors, /^hard stop: .*Merge aborted\. Conflicts: src\/c\.js/);
  assert.equal(git(work, 'status', '--porcelain', '--untracked-files=no'), '');
});

test('restack: a ticket with no stack in its state is refused, and bad arguments exit 2', () => {
  const { work } = makeRepository();
  seedTicket(work, 90, { branch: 'feat/90-x' });
  const { gh, calls } = restackWorld({ parent: 'OPEN' });
  const refused = factory(['restack', '90'], { root: work, gh, git: recordingGit(work).exec });
  assert.equal(refused.code, 2);
  assert.match(refused.errors, /not stacked/);
  assert.equal(factory(['restack'], { root: work, gh }).code, 2);
  assert.equal(factory(['restack', '90', 'x'], { root: work, gh }).code, 2);
  assert.deepEqual(writeCalls(calls), []);
});

// R-40

test('R-40: a stacked PR merged into a branch other than main is in the run report with the recovery step', () => {
  const root = temporaryFolder();
  const { gh, world } = makeWorld({ blockers: [] });
  world.board = [];
  seedTicket(root, 8, { stage: 'green', base: 'feat/92-x', stackedOn: 92 });
  world.branchPrs.set('feat/8-x', [{ number: 96, state: 'MERGED', baseRefName: 'feat/92-x' }]);
  seedRun(root);
  const result = factory(['next'], { root, gh });
  assert.equal(result.code, 0, result.errors);
  assert.match(result.out, /next: done/);
  const report = readFileSync(stateFile(root, 'runs', `${OLD_RUN}-report.md`), 'utf8');
  assert.match(
    report,
    /## Stacked PRs merged outside main\n\n- #8: PR #96 merged into feat\/92-x, not main\. Recovery: /,
  );
  assert.equal(readJson(root, '8', 'ticket.json').mergedInto, 'feat/92-x');
});

test('R-40: a stacked PR merged into main is not in the report', () => {
  const root = temporaryFolder();
  const { gh, world } = makeWorld({ blockers: [] });
  world.board = [];
  seedTicket(root, 8, { stage: 'green', base: 'feat/92-x', stackedOn: 92 });
  world.branchPrs.set('feat/8-x', [{ number: 96, state: 'MERGED', baseRefName: 'main' }]);
  seedRun(root);
  factory(['next'], { root, gh });
  const report = readFileSync(stateFile(root, 'runs', `${OLD_RUN}-report.md`), 'utf8');
  assert.doesNotMatch(report, /Stacked PRs merged outside main/);
});
