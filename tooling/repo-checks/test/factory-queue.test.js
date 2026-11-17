// Tests for `start`, `next`, `status`, `stop` and `report` of scripts/factory.mjs (design
// factory-daily-run 4.1, 4.3, 4.5: R-1 to R-7, R-29, R-43, R-46, R-47, R-50, R-51). `gh` is a stub built from a small world (issues, board, PRs).
// No test calls the real gh or the network.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { main } from '../scripts/factory.mjs';
import { exists, listFilesRecursive, writeAtomic } from '../scripts/lib/fs-io.mjs';

import { pathFromEnv } from './test-env.config.js';

const FACTORY = fileURLToPath(new URL('../scripts/factory.mjs', import.meta.url));
const STATE = '.claude/factory';
const OWNER = 'vpr1995';
const REPO = 'vpr1995/projects-monorepo';
const NOW = new Date('2026-11-17T10:00:00Z');
const RUN_ID = '20261117T100000Z';
// GitHub names these fields in snake case. A computed key keeps the naming rule quiet.
const CREATED = 'created_at';
const SUMMARY = 'sub_issues_summary';
const roots = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const temporaryFolder = () => {
  const root = mkdtempSync(path.join(tmpdir(), 'factory-queue-'));
  roots.push(root);
  return root;
};

const body = (context = 'Paths: `docs/guides/x.md`') =>
  `### Context\n\n${context}\n\n### Acceptance\n\n- [ ] R-1: a thing\n\n### Notes\n\nSize: 2\n`;
const readyEvent = (login, at = '2026-11-10T08:00:00Z') => ({
  event: 'labeled',
  label: { name: 'agent:ready' },
  actor: { login },
  [CREATED]: at,
});
const needsHumanEvent = (at) => ({
  event: 'labeled',
  label: { name: 'needs-human' },
  actor: { login: OWNER },
  [CREATED]: at,
});

/** One issue of the stub world. `extra` replaces any field. */
const makeIssue = (number, extra = {}) => ({
  number,
  state: 'OPEN',
  title: `ticket ${String(number)}`,
  body: body(),
  labels: ['agent:ready'],
  author: OWNER,
  events: [readyEvent(OWNER)],
  blockedBy: [],
  subTotal: 0,
  ...extra,
});

const makeBlocker = (number, extra = {}) => ({ number, state: 'open', labels: [], ...extra });
const makePr = (number, extra = {}) => ({
  number,
  headRefName: `feat/${String(number)}-x`,
  baseRefName: 'main',
  body: '',
  labels: [],
  author: { login: OWNER },
  isCrossRepository: false,
  ...extra,
});
const PASS = [{ name: 'ci', state: 'SUCCESS', bucket: 'pass' }];

const WRITE_FLAGS = new Set(['-X', '--method', '-f', '-F', '--field', '--raw-field', '--input']);
const READ_CALLS = new Set([
  'auth status',
  'repo view',
  'project item-list',
  'issue list',
  'issue view',
  'pr list',
  'pr checks',
  'run list',
]);
/** @returns {boolean} True when the gh call can only read. */
const isRead = (args) =>
  args[0] === 'api'
    ? !args.some((argument) => WRITE_FLAGS.has(argument))
    : READ_CALLS.has(args.slice(0, 2).join(' '));

function answerApi(world, args) {
  const [number, ...rest] = args[1].split('/issues/')[1].split('/');
  const issue = world.issues.get(Number(number));
  const suffix = rest.join('/');
  if (suffix === 'events') return JSON.stringify([issue.events]);
  if (suffix === 'dependencies/blocked_by') return JSON.stringify(issue.blockedBy);
  if (issue.rawApi !== undefined) return JSON.stringify(issue.rawApi);
  return JSON.stringify({ [SUMMARY]: { total: issue.subTotal } });
}

function answerIssue(world, args) {
  if (args[1] === 'list') {
    const label = args[args.indexOf('--label') + 1];
    const open = [...world.issues.values()].filter(
      (issue) => issue.state === 'OPEN' && issue.labels.includes(label),
    );
    return JSON.stringify(open.map((issue) => ({ number: issue.number })));
  }
  const issue = world.issues.get(Number(args[2]));
  return JSON.stringify({
    state: issue.state,
    title: issue.title,
    body: issue.body,
    labels: issue.labels.map((name) => ({ name })),
    author: { login: issue.author },
  });
}

function answer(world, args) {
  const [first, second] = args;
  if (first === 'auth') {
    return `github.com\n  ✓ Logged in to github.com account x (keyring)\n  - Active account: true\n  - Token scopes: ${world.scopes}\n`;
  }
  if (first === 'repo') {
    return JSON.stringify({ nameWithOwner: REPO, owner: { login: world.owner } });
  }
  if (first === 'project' && second === 'item-list') {
    const items = world.board.map((number) => ({
      id: `I_${String(number)}`,
      content: { number, type: 'Issue', repository: REPO },
      status: 'Ready',
    }));
    return JSON.stringify({ items });
  }
  if (first === 'issue') return answerIssue(world, args);
  if (first === 'run') return JSON.stringify(world.runs);
  if (first === 'api') return answerApi(world, args);
  if (first === 'pr' && second === 'list') {
    if (args.includes('--head')) return JSON.stringify(world.branchPrs.get(args[3]) ?? []);
    return JSON.stringify(world.openPrs);
  }
  if (first === 'pr' && second === 'checks') {
    return JSON.stringify(world.checks.get(Number(args[2])) ?? []);
  }
  return '';
}

/** A gh stub over a world. Records each call. */
function makeWorld(config = {}) {
  const world = {
    owner: OWNER,
    scopes: "'gist', 'project', 'repo'",
    board: [],
    issues: new Map(),
    openPrs: [],
    branchPrs: new Map(),
    checks: new Map(),
    runs: [],
    ...config,
  };
  const calls = [];
  const gh = (args) => {
    calls.push(args);
    return answer(world, args);
  };
  const add = (...issues) => {
    for (const issue of issues) {
      world.issues.set(issue.number, issue);
      if (!world.board.includes(issue.number)) world.board.push(issue.number);
    }
  };
  return { world, gh, calls, add };
}

/** Runs `factory start` in process. runOff is a stub, so the real environment cannot leak in. */
function start(words, { gh, root, ...overrides }) {
  const out = [];
  const errors = [];
  const code = main(['node', 'factory.mjs', 'start', ...words], {
    root,
    gh,
    runOff: () => false,
    now: () => NOW,
    pid: process.pid + 1_000_000,
    stdin: () => '',
    sessionId: () => '',
    ...overrides,
    print: (text) => out.push(text),
    err: (text) => errors.push(text),
  });
  return { code, out: out.join(''), errors: errors.join('') };
}

const stateFile = (root, ...parts) => path.join(root, STATE, ...parts);
const readJson = (root, ...parts) => JSON.parse(readFileSync(stateFile(root, ...parts), 'utf8'));
const runLog = (root, runId = RUN_ID) =>
  readFileSync(stateFile(root, 'runs', `${runId}.jsonl`), 'utf8')
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line));
const queued = (out) => [...out.matchAll(/^ +\d+\. #(\d+)/gm)].map((match) => match[1]);

const seedTicket = (root, ticket, extra = {}) =>
  writeAtomic(
    stateFile(root, String(ticket), 'ticket.json'),
    JSON.stringify({
      issue: ticket,
      stage: 'building',
      branch: `feat/${String(ticket)}-x`,
      base: null,
      pr: null,
      restartedAt: null,
      resumes: 0,
      ...extra,
    }),
  );
const seedRun = (root, extra = {}) =>
  writeAtomic(
    stateFile(root, 'run.json'),
    JSON.stringify({
      runId: 'old-run',
      sessionId: 'session-1',
      sessionIds: ['session-1'],
      active: true,
      stalled: false,
      startedAt: '2026-11-16T08:00:00Z',
      only: null,
      next: { kind: 'ticket', ticket: 7 },
      waiting: { pr: 3, since: '2026-11-16T09:00:00Z' },
      stopChecks: { count: 2, lastHash: 'abc' },
      ...extra,
    }),
  );

/** @returns {Map<string, string>} Each file under the state folder with its text. */
function snapshot(root) {
  const folder = path.join(root, STATE);
  if (!exists(folder)) return new Map();
  return new Map(listFilesRecursive(folder).map((file) => [file, readFileSync(file, 'utf8')]));
}

const writeCalls = (calls) => calls.filter((args) => !isRead(args));

// R-1

test('R-1: the queue follows board order, not issue number order, and run.json is written active', () => {
  const root = temporaryFolder();
  const { gh, calls, add, world } = makeWorld();
  add(makeIssue(9), makeIssue(7), makeIssue(8));
  world.board = [8, 9, 7];
  const result = start([], { gh, root });
  assert.equal(result.code, 0, result.errors);
  assert.deepEqual(queued(result.out), ['8', '9', '7']);
  const run = readJson(root, 'run.json');
  assert.equal(run.runId, RUN_ID);
  assert.equal(run.active, true);
  assert.equal(run.stalled, false);
  assert.equal(run.sessionId, null);
  assert.deepEqual(run.sessionIds, []);
  assert.equal(run.only, null);
  assert.equal(run.startedAt, '2026-11-17T10:00:00Z');
  assert.deepEqual(writeCalls(calls), []);
});

test('R-1: an issue that has agent:ready but is not on the board is skipped and logged', () => {
  const root = temporaryFolder();
  const { gh, add, world } = makeWorld();
  add(makeIssue(7), makeIssue(8));
  world.board = [7];
  const result = start([], { gh, root });
  assert.deepEqual(queued(result.out), ['7']);
  assert.match(result.out, /#8: .*not on board 2/);
  assert.ok(runLog(root).some((line) => line.event === 'skip' && line.ticket === 8));
});

test('R-1: an empty queue still writes an active run and prints that the queue is empty', () => {
  const root = temporaryFolder();
  const { gh } = makeWorld();
  const result = start([], { gh, root });
  assert.equal(result.code, 0, result.errors);
  assert.match(result.out, /queue: empty/);
  assert.equal(readJson(root, 'run.json').active, true);
});

// R-2

test('R-2: start <n> queues only #n, stores only in run.json, and reads no board', () => {
  const root = temporaryFolder();
  const { gh, calls, add } = makeWorld();
  add(makeIssue(7), makeIssue(8));
  const result = start(['7'], { gh, root });
  assert.equal(result.code, 0, result.errors);
  assert.deepEqual(queued(result.out), ['7']);
  assert.equal(readJson(root, 'run.json').only, 7);
  assert.ok(!calls.some((args) => args[1] === 'item-list'));
});

test('R-2: start <n> applies the skip rules to #n', () => {
  const root = temporaryFolder();
  const { gh, add } = makeWorld();
  add(makeIssue(7, { labels: [] }));
  const result = start(['7'], { gh, root });
  assert.equal(result.code, 0, result.errors);
  assert.match(result.out, /queue: empty/);
  assert.match(result.out, /#7: no agent:ready/);
});

test('R-2: bad arguments exit 2 with a usage line and write nothing', () => {
  for (const words of [['abc'], ['7', '8'], ['--bogus'], ['--dry-run', '--dry-run'], ['0']]) {
    const root = temporaryFolder();
    const { gh, calls } = makeWorld();
    const result = start(words, { gh, root });
    assert.equal(result.code, 2, words.join(' '));
    assert.match(result.errors, /start/);
    assert.deepEqual(calls, []);
    assert.equal(snapshot(root).size, 0);
  }
});

// R-3

test('R-3: --dry-run prints the plan, makes only read calls, and leaves the state tree byte-identical', () => {
  const root = temporaryFolder();
  const { gh, calls, add, world } = makeWorld();
  // An active run, a ticket whose GitHub stage differs, a restartable needs-human ticket, a skip.
  add(
    makeIssue(7, { labels: ['agent:in-progress'] }),
    makeIssue(8, {
      events: [needsHumanEvent('2026-11-12T08:00:00Z'), readyEvent(OWNER, '2026-11-14T08:00:00Z')],
    }),
    makeIssue(9, { title: '[owner] decide' }),
    makeIssue(10),
  );
  world.branchPrs.set('feat/7-x', [{ number: 70, state: 'OPEN' }]);
  world.checks.set(70, PASS);
  seedRun(root);
  seedTicket(root, 7, { stage: 'building' });
  seedTicket(root, 8, { stage: 'needs-human' });
  const before = snapshot(root);
  const result = start(['--dry-run'], { gh, root });
  assert.equal(result.code, 0, result.errors);
  assert.match(result.out, /dry run/i);
  assert.deepEqual(queued(result.out), ['7', '8', '10']);
  assert.match(result.out, /#9: /);
  assert.ok(calls.length > 0);
  assert.deepEqual(writeCalls(calls), []);
  assert.deepEqual(snapshot(root), before);
  assert.equal(exists(stateFile(root, 'lock')), false);
});

test('R-3: --dry-run on a fresh root creates no state folder at all', () => {
  const root = temporaryFolder();
  const { gh, calls, add } = makeWorld();
  add(makeIssue(7));
  const result = start(['--dry-run'], { gh, root });
  assert.equal(result.code, 0, result.errors);
  assert.deepEqual(writeCalls(calls), []);
  assert.equal(exists(path.join(root, '.claude')), false);
});

test('R-3: --dry-run with <n> in either order queues only #n and writes nothing', () => {
  for (const words of [
    ['7', '--dry-run'],
    ['--dry-run', '7'],
  ]) {
    const root = temporaryFolder();
    const { gh, calls, add } = makeWorld();
    add(makeIssue(7), makeIssue(8));
    const result = start(words, { gh, root });
    assert.equal(result.code, 0, result.errors);
    assert.deepEqual(queued(result.out), ['7']);
    assert.deepEqual(writeCalls(calls), []);
    assert.equal(exists(path.join(root, '.claude')), false);
  }
});

test('R-3: the plan prints the routed passes of each queued ticket from its Paths line', () => {
  const root = temporaryFolder();
  const { gh, add } = makeWorld();
  add(
    makeIssue(7),
    makeIssue(8, { body: body('Paths: `packages/x/src/a.ts`, `packages/x/src/a.test.ts`') }),
  );
  const result = start(['--dry-run'], { gh, root });
  assert.match(
    result.out,
    /Routing: tier medium; passes spec-reviewer \(opus\); skipped fresh-reviewer \(doc-only diff\)/,
  );
  assert.match(result.out, /Routing: tier high; passes .*security-reviewer \(opus\)/);
});

// R-4

test('R-4: FACTORY_RUN=off refuses before any gh call or file write', () => {
  const root = temporaryFolder();
  const { gh, calls } = makeWorld();
  const result = start([], { gh, root, runOff: () => true });
  assert.equal(result.code, 2);
  assert.match(result.errors, /FACTORY_RUN=off/);
  assert.deepEqual(calls, []);
  assert.equal(snapshot(root).size, 0);
  const dry = start(['--dry-run'], { gh, root, runOff: () => true });
  assert.equal(dry.code, 2);
});

test('R-4: a real process with FACTORY_RUN=off exits non-zero and prints the reason', () => {
  const repository = temporaryFolder();
  spawnSync('git', ['init', '-q'], { cwd: repository });
  const env = { PATH: pathFromEnv(), FACTORY_RUN: 'off' };
  const result = spawnSync(process.execPath, [FACTORY, 'start'], {
    cwd: repository,
    env,
    encoding: 'utf8',
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /FACTORY_RUN=off/);
  assert.equal(exists(path.join(repository, '.claude')), false);
});

// R-43: project scope

test('R-43: no project scope refuses and reads no board', () => {
  for (const scopes of ["'gist', 'repo'", "'read:project', 'repo'"]) {
    const root = temporaryFolder();
    const { gh, calls, add } = makeWorld({ scopes });
    add(makeIssue(7));
    const result = start([], { gh, root });
    assert.equal(result.code, 2, scopes);
    assert.match(result.errors, /project/);
    assert.deepEqual(calls, [['auth', 'status']]);
    assert.equal(snapshot(root).size, 0);
  }
});

test('R-43: the scopes of the active account count, not those of another account', () => {
  const root = temporaryFolder();
  const { gh } = makeWorld();
  const account = (name, active, scopes) =>
    `  ✓ Logged in to github.com account ${name} (keyring)\n  - Active account: ${active}\n  - Token scopes: ${scopes}\n`;
  const other = (args) =>
    args[0] === 'auth'
      ? `github.com\n${account('a', false, "'gist', 'project', 'repo'")}\n${account('b', true, "'gist', 'repo'")}`
      : gh(args);
  assert.equal(start([], { gh: other, root }).code, 2);
});

// R-43: skip reasons

const SKIPS = [
  ['the issue is closed', { state: 'CLOSED' }, /closed/],
  ['the issue has no agent:ready', { labels: [] }, /no agent:ready/],
  [
    'the issue has agent:in-progress with no local state',
    { labels: ['agent:ready', 'agent:in-progress'] },
    /agent:in-progress/,
  ],
  ['the issue has needs-human', { labels: ['agent:ready', 'needs-human'] }, /needs-human/],
  ['the title has [owner]', { title: 'Pick one [OWNER]' }, /\[owner\]/],
  ['the issue is a parent', { subTotal: 2 }, /parent/],
  ['the issue has no Acceptance checkbox', { body: '### Acceptance\n\nnothing\n' }, /Acceptance/],
  [
    'the checkbox sits in another section',
    { body: '### Acceptance\n\nnone\n\n### Notes\n\n- [ ] not acceptance\n' },
    /Acceptance/,
  ],
  [
    'Paths names tooling/repo-checks',
    { body: body('Paths: `docs/a.md`, `tooling/repo-checks/scripts/x.mjs`') },
    /Paths/,
  ],
  ['Paths names .claude/settings.json', { body: body('Paths: `.claude/settings.json`') }, /Paths/],
];

// A closed issue, or an issue with no label, is not in the lists that build the board queue. Only
// `start <n>` reaches the rule. The other reasons also come up in the board queue.
const DIRECT = new Set(['the issue is closed', 'the issue has no agent:ready']);

for (const [name, extra, reason] of SKIPS) {
  test(`R-43: a ticket is skipped and logged when ${name}`, () => {
    const root = temporaryFolder();
    const { gh, add } = makeWorld();
    add(makeIssue(7, extra), makeIssue(8));
    const direct = DIRECT.has(name);
    const result = start(direct ? ['7'] : [], { gh, root });
    assert.equal(result.code, 0, result.errors);
    assert.match(result.out, /#7: /);
    assert.match(
      result.out.split('\n').find((line) => line.includes('#7: ')),
      reason,
    );
    assert.deepEqual(queued(result.out), direct ? [] : ['8']);
    const skip = runLog(root).find((line) => line.event === 'skip' && line.ticket === 7);
    assert.match(skip.detail, reason);
  });
}

test('R-43: Paths can name tooling/ outside repo-checks and .claude outside settings.json', () => {
  const root = temporaryFolder();
  const { gh, add } = makeWorld();
  add(makeIssue(7, { body: body('Paths: `tooling/eslint-config/a.mjs`, `.claude/skills/a.md`') }));
  const result = start([], { gh, root });
  assert.deepEqual(queued(result.out), ['7']);
});

const FORBIDDEN_PATHS = [
  ['a bare token after a backticked one', 'Paths: `src/a.ts` and tooling/repo-checks/x.mjs'],
  ['a second Paths line', 'Paths: `src/a.ts`\nPaths: tooling/repo-checks/x.mjs'],
  ['a dot dot segment', 'Paths: `src/../tooling/repo-checks/x`'],
  ['a leading slash', 'Paths: `/tooling/repo-checks/x`'],
  ['a bold label', '**Paths:** tooling/repo-checks/x'],
  ['a double slash', 'Paths: tooling//repo-checks/x'],
  ['trailing punctuation', 'Paths: tooling/repo-checks,'],
  ['trailing dot and bracket', 'Paths: (tooling/repo-checks/x.mjs).'],
  ['a glob over the parent folder', 'Paths: tooling/**'],
  ['a glob over .claude', 'Paths: .claude/*'],
  ['a glob with a partial name', 'Paths: tooling/repo-*'],
  ['a dot segment in settings.json', 'Paths: .claude/./settings.json'],
  ['the parent folder', 'Paths: tooling'],
  ['the .claude folder', 'Paths: `.claude`'],
  ['a folder that resolves to the root', 'Paths: `src/..`'],
  ['another letter case', 'Paths: Tooling/Repo-Checks/x.mjs'],
  ['a ticked star', 'Paths: `*`'],
  ['a ticked star glob', 'Paths: `**/*`'],
  ['a ticked dot', 'Paths: `.`'],
  ['a bare glob after a ticked path', 'Paths: `src/a`, tooling/*'],
  ['a bare folder after a ticked path', 'Paths: `src/a` .claude/'],
];

for (const [name, context] of FORBIDDEN_PATHS) {
  test(`R-43: a ticket is skipped when Paths has ${name}`, () => {
    const root = temporaryFolder();
    const { gh, add } = makeWorld();
    add(makeIssue(7, { body: body(context) }));
    const result = start([], { gh, root });
    assert.match(result.out, /#7: .*Paths/, context);
    assert.deepEqual(queued(result.out), [], context);
  });
}

// Round 3. A false positive of the token check or the body backstop only skips a ticket.
const QUEUED_PATHS = [
  ['a backticked path and a final dot', 'Paths: `src/a.ts`.'],
  ['a slash of prose between two paths', 'Paths: `a` / `b`'],
  ['two paths with a prose word and a final dot', 'Paths: `a.ts` and `b.ts`.'],
];

for (const [name, context] of QUEUED_PATHS) {
  test(`R-43: a ticket is queued when Paths has ${name}`, () => {
    const root = temporaryFolder();
    const { gh, add } = makeWorld();
    add(makeIssue(7, { body: body(context) }));
    assert.deepEqual(queued(start([], { gh, root }).out), ['7'], context);
  });
}

const BYPASS_PATHS = [
  ['a list dash', '- Paths: tooling/repo-checks/x'],
  ['a quoted value in lower case', 'paths: "tooling/repo-checks/x"'],
  ['a list on the next lines', 'Paths:\n- tooling/repo-checks/x'],
  ['angle brackets', '<tooling/repo-checks>'],
  ['a line anchor', 'See .claude/settings.json#L3'],
  ['settings.local.json', 'See .claude/settings.local.json'],
  ['a zero-width space', 'See tooling/repo​-checks/x'],
  ['a soft hyphen and a BOM', 'See tooling/repo­-che﻿cks/x'],
  ['a control character', 'See tooling/repo\u0001-checks/x'],
  ['a full-width hyphen', 'See tooling/repo－checks/x'],
  ['backslashes', String.raw`See tooling\repo-checks\x`],
  ['an escaped slash', 'See tooling%2Frepo-checks'],
  ['an escaped slash in capitals', 'See tooling%2Frepo-checks'.toUpperCase()],
];

for (const [name, context] of BYPASS_PATHS) {
  test(`R-43: a ticket is skipped when the body has ${name}`, () => {
    const root = temporaryFolder();
    const { gh, add } = makeWorld();
    add(makeIssue(7, { body: body(context) }));
    const result = start([], { gh, root });
    assert.match(result.out, /#7: .*Paths/, JSON.stringify(context));
    assert.deepEqual(queued(result.out), [], JSON.stringify(context));
  });
}

test('R-3: a bare path-like word after a ticked doc path counts: not tier low', () => {
  const root = temporaryFolder();
  const { gh, add } = makeWorld();
  add(makeIssue(7, { body: body('Paths: `docs/a.md`, src/x.ts') }));
  const lines = start([], { gh, root }).out.split('\n');
  const routing = lines[lines.findIndex((line) => line.includes('#7 ')) + 1];
  assert.match(routing, /Routing: tier /);
  assert.doesNotMatch(routing, /tier low/);
});

test('R-3: two backticked paths with a prose word route as one doc path: tier low', () => {
  const root = temporaryFolder();
  const { gh, add } = makeWorld();
  add(
    makeIssue(7, { body: body('Paths: `docs/a.md` and `docs/b.md`.') }),
    makeIssue(8, { body: body('Paths: `docs/a.md`') }),
  );
  const lines = start([], { gh, root }).out.split('\n');
  const routing = (number) => lines[lines.findIndex((line) => line.includes(`#${number} `)) + 1];
  assert.match(routing(7), /Routing: tier low; passes spec-reviewer/);
  assert.equal(routing(7), routing(8));
});

for (const mark of [';', ')']) {
  test(`R-43: a Paths token with 65000 "${mark}" is cleaned in linear time`, () => {
    const root = temporaryFolder();
    const { gh, add } = makeWorld();
    add(makeIssue(7, { body: body(`Paths: a${mark.repeat(65_000)}x`) }));
    const began = performance.now();
    const result = start([], { gh, root });
    const elapsed = performance.now() - began;
    assert.deepEqual(queued(result.out), ['7']);
    assert.ok(elapsed < 500, `took ${String(elapsed)} ms`);
  });
}

test('R-43: Paths with a glob or a prose word outside the forbidden paths does not skip', () => {
  const root = temporaryFolder();
  const { gh, add } = makeWorld();
  add(
    makeIssue(7, { body: body('Paths: `src/a.ts` and docs/b.md, tooling/other-x/*') }),
    makeIssue(8, { body: body('Paths: tooling/eslint-config/x, `.claude/skills/x`') }),
  );
  assert.deepEqual(queued(start([], { gh, root }).out), ['7', '8']);
});

test('R-43: a parent issue check that cannot read the sub-issue count skips the ticket', () => {
  for (const rawApi of [
    {},
    { [SUMMARY]: null },
    { [SUMMARY]: { total: '0' } },
    { [SUMMARY]: {} },
  ]) {
    const root = temporaryFolder();
    const { gh, add } = makeWorld();
    add(makeIssue(7, { rawApi }), makeIssue(8));
    const result = start([], { gh, root });
    assert.match(result.out, /#7: .*parent/, JSON.stringify(rawApi));
    assert.deepEqual(queued(result.out), ['8']);
  }
});

test('R-43: the Acceptance section ends at any heading of level 1 to 3', () => {
  for (const heading of ['# Other', '## Other', '### Other']) {
    const root = temporaryFolder();
    const { gh, add } = makeWorld();
    add(makeIssue(7, { body: `### Acceptance\n\n${heading}\n- [ ] x\n` }));
    const result = start([], { gh, root });
    assert.match(result.out, /#7: .*Acceptance/, heading);
  }
});

test('R-1: a ticket twice on the board is queued once and a skip is logged once', () => {
  const root = temporaryFolder();
  const { gh, add, world } = makeWorld();
  add(makeIssue(7), makeIssue(8), makeIssue(9, { title: '[owner] x' }));
  world.board = [7, 9, 8, 7, 9];
  const result = start([], { gh, root });
  assert.deepEqual(queued(result.out), ['7', '8']);
  assert.equal(runLog(root).filter((line) => line.event === 'skip' && line.ticket === 9).length, 1);
});

test('R-43: a skipped ticket shows no title or body text in the plan or the log', () => {
  const root = temporaryFolder();
  const { gh, add } = makeWorld();
  add(makeIssue(7, { title: 'SECRET-TITLE [owner]', body: 'SECRET-BODY' }));
  const result = start([], { gh, root });
  assert.doesNotMatch(result.out, /SECRET/);
  assert.ok(runLog(root).every((line) => !line.detail.includes('SECRET')));
});

test('R-43: agent:in-progress with a local ticket.json is not skipped: it resumes, and reconcile runs under start (R-14, R-23)', () => {
  const root = temporaryFolder();
  const { gh, add, world, calls } = makeWorld();
  add(makeIssue(7, { labels: ['agent:in-progress'], body: 'no acceptance here' }));
  world.branchPrs.set('feat/7-x', [{ number: 70, state: 'OPEN' }]);
  world.checks.set(70, PASS);
  seedTicket(root, 7, { stage: 'building' });
  const result = start([], { gh, root });
  assert.equal(result.code, 0, result.errors);
  assert.deepEqual(queued(result.out), ['7']);
  assert.match(result.out, /1\. #7 resume/);
  assert.match(result.out, /reconcile #7: local=building github=green/);
  assert.equal(readJson(root, '7', 'ticket.json').stage, 'green');
  assert.ok(runLog(root).some((line) => line.event === 'reconcile' && line.ticket === 7));
  assert.deepEqual(writeCalls(calls), []);
});

// R-7

test('R-7: a non-owner issue author is skipped', () => {
  const root = temporaryFolder();
  const { gh, add } = makeWorld();
  add(makeIssue(7, { author: 'mallory' }), makeIssue(8));
  const result = start([], { gh, root });
  assert.match(result.out, /#7: .*author/);
  assert.deepEqual(queued(result.out), ['8']);
});

test('R-7: a non-owner as the last agent:ready actor is skipped, even after an owner label', () => {
  const root = temporaryFolder();
  const { gh, add } = makeWorld();
  add(
    makeIssue(7, {
      events: [
        readyEvent(OWNER, '2026-11-10T08:00:00Z'),
        readyEvent('mallory', '2026-11-11T08:00:00Z'),
      ],
    }),
  );
  const result = start([], { gh, root });
  assert.match(result.out, /#7: .*agent:ready was not added by the owner/);
  assert.match(result.out, /queue: empty/);
});

test('R-7: no labeled event, a null actor, or events of other labels fail closed', () => {
  const other = { ...readyEvent(OWNER), label: { name: 'bug' } };
  for (const events of [[], [{ ...readyEvent(OWNER), actor: null }], [other]]) {
    const root = temporaryFolder();
    const { gh, add } = makeWorld();
    add(makeIssue(7, { events }));
    const result = start([], { gh, root });
    assert.match(result.out, /queue: empty/, JSON.stringify(events));
  }
});

test('R-7: an owner author and an owner label actor are queued, and logins compare without case', () => {
  const root = temporaryFolder();
  const { gh, add } = makeWorld();
  add(makeIssue(7, { author: 'VPR1995', events: [readyEvent('Vpr1995')] }));
  const result = start([], { gh, root });
  assert.deepEqual(queued(result.out), ['7']);
  assert.match(result.out, /1\. #7 new/);
});

// R-6 and R-36

function stackWorld({ blockers = [makeBlocker(7)], prs = [makePr(70)], checks = PASS } = {}) {
  const harness = makeWorld();
  harness.add(makeIssue(7, { labels: [] }), makeIssue(8, { blockedBy: blockers }));
  harness.world.openPrs = prs.map(({ closes = 7, ...pr }) => ({
    ...pr,
    body: `Closes #${String(closes)}`,
  }));
  for (const pr of prs) harness.world.checks.set(pr.number, checks);
  return harness;
}

test('R-36: a blocker with an open PR, green CI and no needs-human is stacked on, depth 2', () => {
  const root = temporaryFolder();
  const { gh } = stackWorld();
  const result = start([], { gh, root });
  assert.equal(result.code, 0, result.errors);
  assert.deepEqual(queued(result.out), ['8']);
  assert.match(result.out, /1\. #8 new, stacked on #7 \(PR #70, branch feat\/70-x, depth 2\)/);
  assert.match(result.out, /Routing: /);
});

test('R-6: a closed blocker does not block', () => {
  const root = temporaryFolder();
  const { gh } = stackWorld({ blockers: [makeBlocker(7, { state: 'closed' })], prs: [] });
  const result = start([], { gh, root });
  assert.match(result.out, /1\. #8 new\n/);
});

const BLOCKED_CASES = [
  ['the blocker has no open PR', { prs: [] }, /blocked by #7: no open PR/],
  [
    'the CI of the blocker PR is red',
    { checks: [{ name: 'a', state: 'FAILURE', bucket: 'fail' }] },
    /#7: CI of PR #70 is not green/,
  ],
  [
    'the CI of the blocker PR is pending',
    { checks: [{ name: 'a', state: 'PENDING', bucket: 'pending' }] },
    /#7: CI of PR #70 is pending/,
  ],
  [
    'the blocker issue has needs-human',
    { blockers: [makeBlocker(7, { labels: [{ name: 'needs-human' }] })] },
    /#7: needs-human/,
  ],
  [
    'the blocker PR has needs-human',
    { prs: [makePr(70, { labels: [{ name: 'needs-human' }] })] },
    /#7: needs-human/,
  ],
  [
    'the blocker PR is from a fork',
    { prs: [makePr(70, { isCrossRepository: true })] },
    /#7: no open PR/,
  ],
  [
    'the blocker PR is not by the owner',
    { prs: [makePr(70, { author: { login: 'mallory' } })] },
    /#7: no open PR/,
  ],
  [
    'the blocker PR has no author field',
    { prs: [makePr(70, { author: undefined })] },
    /#7: no open PR/,
  ],
  ['two blockers are open', { blockers: [makeBlocker(7), makeBlocker(6)] }, /more than one/],
  [
    'the blocker PR is already stacked (depth 3)',
    { prs: [makePr(70, { baseRefName: 'feat/60-x' }), makePr(60, { closes: 5 })] },
    /depth/,
  ],
];

for (const [name, config, reason] of BLOCKED_CASES) {
  test(`R-6: a blocked ticket is skipped and logged when ${name}`, () => {
    const root = temporaryFolder();
    const { gh } = stackWorld(config);
    const result = start([], { gh, root });
    assert.equal(result.code, 0, result.errors);
    assert.match(result.out, reason);
    assert.deepEqual(queued(result.out), []);
    const skip = runLog(root).find((line) => line.event === 'skip' && line.ticket === 8);
    assert.match(skip.detail, reason);
  });
}

test('R-36: the stack depth counts PRs of other authors in the chain', () => {
  const root = temporaryFolder();
  // Chain: PR 70 (owner) on PR 60 (mallory) on PR 50 (owner) on main. It is 3 deep, plus the ticket.
  const { gh } = stackWorld({
    prs: [
      makePr(70, { baseRefName: 'feat/60-x' }),
      makePr(60, { baseRefName: 'feat/50-x', author: { login: 'mallory' }, closes: 5 }),
      makePr(50, { closes: 4 }),
    ],
  });
  const result = start([], { gh, root });
  assert.match(result.out, /#7: stack depth 4 is over 2/);
  assert.deepEqual(queued(result.out), []);
});

// R-50

test('R-50: an active or stalled run is adopted: session cleared, run id kept, "resumed" logged, no label change', () => {
  for (const extra of [
    { active: true, stalled: false },
    { active: false, stalled: true },
  ]) {
    const root = temporaryFolder();
    const { gh, calls, add } = makeWorld();
    add(makeIssue(7));
    seedRun(root, extra);
    const result = start([], { gh, root });
    assert.equal(result.code, 0, result.errors);
    assert.match(result.out, /adopted/);
    const run = readJson(root, 'run.json');
    assert.equal(run.runId, 'old-run');
    assert.equal(run.active, true);
    assert.equal(run.stalled, false);
    assert.equal(run.sessionId, null);
    assert.deepEqual(run.sessionIds, ['session-1']);
    assert.deepEqual(run.stopChecks, { count: 0, lastHash: null });
    assert.equal(run.waiting, null);
    const resumed = runLog(root, 'old-run').find((line) => line.event === 'resume');
    assert.match(resumed.detail, /resumed/);
    assert.deepEqual(writeCalls(calls), []);
  }
});

test('R-50: start <n> on an adopted run sets only; a plain start clears it', () => {
  const root = temporaryFolder();
  const { gh, add } = makeWorld();
  add(makeIssue(7));
  seedRun(root, { only: 3 });
  start([], { gh, root });
  assert.equal(readJson(root, 'run.json').only, null);
  start(['7'], { gh, root });
  assert.equal(readJson(root, 'run.json').only, 7);
});

test('R-50: an ended run gives a new run with a new id and no session', () => {
  const root = temporaryFolder();
  const { gh } = makeWorld();
  seedRun(root, { active: false, stalled: false });
  const result = start([], { gh, root });
  assert.ok(result.out.includes(`run ${RUN_ID}:`), result.out);
  const run = readJson(root, 'run.json');
  assert.equal(run.runId, RUN_ID);
  assert.equal(run.sessionId, null);
  assert.deepEqual(run.sessionIds, [], 'no session id is set: the list is empty');
});

test('R-50: a new run records only the current session id and does NOT carry over the earlier ones', () => {
  const root = temporaryFolder();
  const { gh } = makeWorld();
  seedRun(root, { active: false, stalled: false, sessionIds: ['old-1', 'old-2'] });
  const result = start([], { gh, root, sessionId: () => 'now-1' });
  assert.equal(result.code, 0, result.errors);
  const run = readJson(root, 'run.json');
  assert.equal(run.runId, RUN_ID);
  assert.deepEqual(run.sessionIds, ['now-1']);
});

test('R-50: a new run with no earlier run records the current session id', () => {
  const root = temporaryFolder();
  const { gh } = makeWorld();
  assert.equal(start([], { gh, root, sessionId: () => 'now-1' }).code, 0);
  assert.deepEqual(readJson(root, 'run.json').sessionIds, ['now-1']);
});

test('R-50: an adopted run adds the current session id once', () => {
  const root = temporaryFolder();
  const { gh } = makeWorld();
  seedRun(root, { sessionIds: ['old-1'] });
  assert.equal(start([], { gh, root, sessionId: () => 'now-1' }).code, 0);
  assert.equal(start([], { gh, root, sessionId: () => 'now-1' }).code, 0);
  assert.deepEqual(readJson(root, 'run.json').sessionIds, ['old-1', 'now-1']);
});

test('R-50: a session id that is not valid or not set is not recorded', () => {
  const root = temporaryFolder();
  const { gh } = makeWorld();
  seedRun(root, { active: false, stalled: false, sessionIds: ['old-1'] });
  assert.equal(start([], { gh, root, sessionId: () => '../x' }).code, 0);
  assert.deepEqual(readJson(root, 'run.json').sessionIds, []);
  seedRun(root, { active: false, stalled: false, sessionIds: [] });
  assert.equal(start([], { gh, root, sessionId: () => '' }).code, 0);
  assert.deepEqual(readJson(root, 'run.json').sessionIds, []);
});

test('R-50: a run.json that is not valid is refused before anything is written', () => {
  const root = temporaryFolder();
  const { gh } = makeWorld();
  writeAtomic(stateFile(root, 'run.json'), JSON.stringify({ runId: '../x', active: true }));
  const before = snapshot(root);
  const result = start([], { gh, root });
  assert.equal(result.code, 2);
  assert.match(result.errors, /run\.json/);
  assert.deepEqual(snapshot(root), before);
});

test('R-50: a start that fails before the plan is built writes no run.json', () => {
  const root = temporaryFolder();
  const { gh } = makeWorld();
  const result = start(['99999'], { gh, root });
  assert.notEqual(result.code, 0);
  assert.equal(exists(stateFile(root, 'run.json')), false);
  assert.equal(exists(stateFile(root, 'lock')), false);
});

test('R-50: an adopt whose plan fails leaves the old run.json byte-identical and logs no resume', () => {
  for (const extra of [{ stalled: true, active: false }, { active: true }]) {
    const root = temporaryFolder();
    const { gh, add } = makeWorld();
    add(makeIssue(7));
    seedRun(root, extra);
    const before = snapshot(root);
    const broken = (args) => {
      if (args[0] === 'repo') throw new Error('gh: network down');
      return gh(args);
    };
    const result = start([], { gh: broken, root });
    assert.notEqual(result.code, 0);
    assert.deepEqual(snapshot(root), before);
  }
});

test('R-50: when the restore of run.json also fails, the original error stays and names the restore failure', () => {
  const root = temporaryFolder();
  const { gh, add } = makeWorld();
  add(makeIssue(7));
  seedRun(root, { stalled: true, active: false });
  const broken = (args) => {
    if (args[0] === 'repo') {
      // A folder in place of run.json makes the restore (a rename over it) fail.
      rmSync(stateFile(root, 'run.json'));
      mkdirSync(stateFile(root, 'run.json'));
      throw new Error('gh: network down');
    }
    return gh(args);
  };
  const result = start([], { gh: broken, root });
  assert.notEqual(result.code, 0);
  assert.match(
    result.errors,
    /unexpected error: gh: network down; run\.json restore also failed: /,
  );
});

// R-51 and R-53

test('R-51: a restarted needs-human ticket gets restartedAt and resumes + 1 before reconcile moves it', () => {
  const root = temporaryFolder();
  const { gh, add, world } = makeWorld();
  add(
    makeIssue(7, {
      events: [needsHumanEvent('2026-11-12T08:00:00Z'), readyEvent(OWNER, '2026-11-14T08:00:00Z')],
    }),
  );
  seedTicket(root, 7, { stage: 'needs-human', resumes: 1 });
  // The restarted ticket has an open PR with green CI: reconcile moves it to green. The restart still counts.
  world.branchPrs.set('feat/7-x', [{ number: 70, state: 'OPEN' }]);
  world.checks.set(70, PASS);
  const result = start([], { gh, root });
  assert.equal(result.code, 0, result.errors);
  const ticket = readJson(root, '7', 'ticket.json');
  assert.equal(ticket.restartedAt, '2026-11-14T08:00:00Z');
  assert.equal(ticket.resumes, 2);
  assert.equal(ticket.stage, 'green');
});

test('R-53: a lock held by a live process refuses start; a dry run takes no lock', () => {
  const root = temporaryFolder();
  const { gh, add } = makeWorld();
  add(makeIssue(7));
  writeAtomic(stateFile(root, 'lock'), String(process.pid));
  const refused = start([], { gh, root });
  assert.equal(refused.code, 2);
  assert.match(refused.errors, /lock held/);
  assert.equal(exists(stateFile(root, 'run.json')), false);
  const dry = start(['--dry-run'], { gh, root });
  assert.equal(dry.code, 0, dry.errors);
});

test('start releases the lock when it ends', () => {
  const root = temporaryFolder();
  const { gh, add } = makeWorld();
  add(makeIssue(7));
  start([], { gh, root });
  assert.equal(exists(stateFile(root, 'lock')), false);
});

// next, status, stop, report (task 2c2: R-5, R-29, R-46, R-47)

const NO_GH = () => {
  throw new Error('no gh call expected');
};

/** Runs one factory command in process. */
function factory(command, words, { gh = NO_GH, root, ...overrides }) {
  const out = [];
  const errors = [];
  const code = main(['node', 'factory.mjs', command, ...words], {
    root,
    gh,
    runOff: () => false,
    now: () => NOW,
    pid: process.pid + 1_000_000,
    stdin: () => '',
    ...overrides,
    print: (text) => out.push(text),
    err: (text) => errors.push(text),
  });
  return { code, out: out.join(''), errors: errors.join('') };
}

const OLD_RUN = 'old-run';
const REPORT = `runs/${OLD_RUN}-report.md`;
const NOT_WAITING = { next: null, waiting: null, stopChecks: { count: 0, lastHash: null } };
const logLine = (ticket, event, extra = {}) => ({
  ts: '2026-11-17T09:00:00Z',
  ticket,
  event,
  from: null,
  to: null,
  detail: '',
  ...extra,
});
const seedLog = (root, lines) =>
  writeAtomic(
    stateFile(root, 'runs', `${OLD_RUN}.jsonl`),
    `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`,
  );
const readReport = (root) => readFileSync(stateFile(root, REPORT), 'utf8');
const ticketBytes = (root) =>
  new Map([...snapshot(root)].filter(([file]) => file.endsWith('ticket.json')));

// next: R-5

test('R-5: an empty queue gives done, writes the run report, and clears the run', () => {
  const root = temporaryFolder();
  const { gh, calls } = makeWorld();
  seedRun(root, NOT_WAITING);
  const result = factory('next', [], { gh, root });
  assert.equal(result.code, 0, result.errors);
  assert.match(result.out, /next: done/);
  assert.ok(result.out.includes(`${STATE}/${REPORT}`));
  const run = readJson(root, 'run.json');
  assert.equal(run.active, false);
  assert.deepEqual(run.next, { kind: 'done' });
  assert.match(readReport(root), /^# Run report: old-run$/m);
  assert.match(readReport(root), /## Resume command\n+`\/factory`/);
  assert.deepEqual(writeCalls(calls), []);
});

test('R-5: when each ticket left is blocked and cannot stack, next gives done and the report lists the skip', () => {
  const root = temporaryFolder();
  const { gh, add } = makeWorld();
  add(makeIssue(7, { blockedBy: [makeBlocker(3)] }));
  seedRun(root, NOT_WAITING);
  const result = factory('next', [], { gh, root });
  assert.equal(result.code, 0, result.errors);
  assert.match(result.out, /next: done/);
  assert.equal(readJson(root, 'run.json').active, false);
  assert.match(readReport(root), /## Tickets skipped\n+- #7: blocked by #3: no open PR/);
  assert.ok(runLog(root, OLD_RUN).some((line) => line.event === 'skip' && line.ticket === 7));
});

test('R-5: the run has no ticket count limit: many done tickets do not end it', () => {
  const root = temporaryFolder();
  const { gh, add } = makeWorld();
  add(makeIssue(20));
  for (const ticket of [11, 12, 13, 14, 15, 16]) seedTicket(root, ticket, { stage: 'done' });
  seedRun(root, NOT_WAITING);
  seedLog(
    root,
    [11, 12, 13, 14, 15, 16].map((ticket) => logLine(ticket, 'stage')),
  );
  const result = factory('next', [], { gh, root });
  assert.equal(result.code, 0, result.errors);
  assert.match(result.out, /next: start #20/);
  assert.equal(readJson(root, 'run.json').active, true);
});

test('R-5: a ticket to start is stored in run.json next, with no gh write', () => {
  const root = temporaryFolder();
  const { gh, calls, add } = makeWorld();
  add(makeIssue(8), makeIssue(9));
  seedRun(root, NOT_WAITING);
  const result = factory('next', [], { gh, root });
  assert.equal(result.code, 0, result.errors);
  assert.match(result.out, /next: start #8/);
  assert.deepEqual(readJson(root, 'run.json').next, { kind: 'ticket', ticket: 8, resume: false });
  assert.equal(readJson(root, 'run.json').active, true);
  assert.deepEqual(writeCalls(calls), []);
  assert.equal(exists(stateFile(root, REPORT)), false, 'no report while the run goes on');
});

test('R-43: a ticket with agent:in-progress and a ticket.json resumes at its stage, before a new ticket', () => {
  const root = temporaryFolder();
  const { gh, add, world } = makeWorld();
  add(makeIssue(8), makeIssue(7, { labels: ['agent:in-progress'], body: 'no acceptance here' }));
  world.board = [8, 7];
  seedTicket(root, 7, { stage: 'reviewing' });
  seedRun(root, NOT_WAITING);
  const result = factory('next', [], { gh, root });
  assert.equal(result.code, 0, result.errors);
  assert.match(result.out, /next: resume #7 \(stage reviewing\)/);
  assert.deepEqual(readJson(root, 'run.json').next, {
    kind: 'ticket',
    ticket: 7,
    resume: true,
    stage: 'reviewing',
  });
});

test('R-23: next reconciles a local ticket with GitHub before it picks', () => {
  const root = temporaryFolder();
  const { gh, add, world } = makeWorld();
  add(makeIssue(7, { labels: ['agent:in-progress'], body: 'x' }));
  world.branchPrs.set('feat/7-x', [{ number: 70, state: 'OPEN' }]);
  world.checks.set(70, PASS);
  seedTicket(root, 7, { stage: 'building' });
  seedRun(root, NOT_WAITING);
  const result = factory('next', [], { gh, root });
  assert.match(result.out, /reconcile #7: local=building github=green/);
  assert.equal(readJson(root, '7', 'ticket.json').stage, 'green');
  // Review round 1, G: a green ticket waits for the owner (design 4.4). `next` does not resume it.
  assert.doesNotMatch(result.out, /resume #7/);
  assert.match(result.out, /next: done/);
  assert.deepEqual(readJson(root, 'run.json').next, { kind: 'done' });
});

test('R-23: a green ticket with agent:in-progress and a ticket.json does not stop next from giving done', () => {
  const root = temporaryFolder();
  const { gh, add, world } = makeWorld();
  add(makeIssue(7, { labels: ['agent:in-progress'], body: 'x' }));
  world.branchPrs.set('feat/7-x', [{ number: 70, state: 'OPEN' }]);
  world.checks.set(70, PASS);
  seedTicket(root, 7, { stage: 'green', pr: 70 });
  seedRun(root, NOT_WAITING);
  const result = factory('next', [], { gh, root });
  assert.equal(result.code, 0, result.errors);
  assert.match(result.out, /next: done/);
  assert.doesNotMatch(result.out, /resume/);
  assert.equal(readJson(root, 'run.json').active, false);
});

test('R-23: needs-human and done tickets with agent:in-progress are not resumed either', () => {
  const root = temporaryFolder();
  const { gh, add } = makeWorld();
  add(makeIssue(7, { labels: ['agent:in-progress'], body: 'x' }));
  add(makeIssue(6, { labels: ['agent:in-progress'], body: 'x' }));
  seedTicket(root, 7, { stage: 'needs-human' });
  seedTicket(root, 6, { stage: 'done' });
  seedRun(root, NOT_WAITING);
  const result = factory('next', [], { gh, root });
  assert.equal(result.code, 0, result.errors);
  assert.doesNotMatch(result.out, /resume/);
});

test('R-2: next respects only: other ready tickets do not count', () => {
  const root = temporaryFolder();
  const { gh, add } = makeWorld();
  add(makeIssue(7, { blockedBy: [makeBlocker(3)] }), makeIssue(8));
  seedRun(root, { ...NOT_WAITING, only: 7 });
  const result = factory('next', [], { gh, root });
  assert.equal(result.code, 0, result.errors);
  assert.match(result.out, /next: done/);
  assert.match(readReport(root), /Scope: only #7/);
  assert.match(readReport(root), /`\/factory 7`/);
});

test('R-5: a stored CI wait of the run gives next wait, with no gh call', () => {
  const root = temporaryFolder();
  const waiting = { pr: 3, since: '2026-11-17T09:30:00Z', pid: process.pid };
  seedRun(root, { next: null, waiting });
  const result = factory('next', [], { root, isAlive: () => true });
  assert.equal(result.code, 0, result.errors);
  assert.match(result.out, /next: wait for the CI of PR #3/);
  assert.deepEqual(readJson(root, 'run.json').next, { kind: 'wait', pr: 3 });
  assert.equal(readJson(root, 'run.json').active, true);
});

test('R-49: a wait of a dead process is cleared and next goes on', () => {
  const root = temporaryFolder();
  const { gh, add } = makeWorld();
  add(makeIssue(8));
  const waiting = { pr: 3, since: '2026-11-17T09:30:00Z', pid: 424_242 };
  seedRun(root, { ...NOT_WAITING, waiting });
  const result = factory('next', [], { gh, root, isAlive: () => false });
  assert.equal(result.code, 0, result.errors);
  assert.doesNotMatch(result.out, /wait for the CI/);
  assert.match(result.out, /next: start #8/);
  assert.equal(readJson(root, 'run.json').waiting, null);
});

test('R-49: a wait older than 60 minutes is cleared and next goes on', () => {
  const root = temporaryFolder();
  const { gh, add } = makeWorld();
  add(makeIssue(8));
  const waiting = { pr: 3, since: '2026-11-17T08:59:00Z', pid: process.pid };
  seedRun(root, { ...NOT_WAITING, waiting });
  const result = factory('next', [], { gh, root, isAlive: () => true });
  assert.equal(result.code, 0, result.errors);
  assert.match(result.out, /next: start #8/);
  assert.equal(readJson(root, 'run.json').waiting, null);
});

test('next refuses when no run is active, and writes nothing', () => {
  const root = temporaryFolder();
  const none = factory('next', [], { root });
  assert.equal(none.code, 2);
  assert.match(none.errors, /no active run/);
  seedRun(root, { ...NOT_WAITING, active: false });
  const before = snapshot(root);
  const ended = factory('next', [], { root });
  assert.equal(ended.code, 2);
  assert.match(ended.errors, /no active run/);
  assert.deepEqual(snapshot(root), before);
});

test('next logs a skip once: a second call adds no line, so the active time of caps does not grow', () => {
  const root = temporaryFolder();
  const { gh, add } = makeWorld();
  add(makeIssue(9, { labels: ['agent:ready', 'needs-human'] }), makeIssue(8));
  seedRun(root, NOT_WAITING);
  assert.equal(factory('next', [], { gh, root }).code, 0);
  assert.equal(factory('next', [], { gh, root }).code, 0);
  assert.equal(runLog(root, OLD_RUN).filter((line) => line.ticket === 9).length, 1);
});

test('next shows no title or body text in the output, the log, or the report', () => {
  const root = temporaryFolder();
  const { gh, add } = makeWorld();
  add(
    makeIssue(7, {
      title: 'SECRET-TITLE',
      body: 'SECRET-BODY',
      labels: ['agent:ready', 'needs-human'],
    }),
  );
  seedRun(root, NOT_WAITING);
  const result = factory('next', [], { gh, root });
  assert.match(result.out, /next: done/);
  const text = [...snapshot(root).values()].join('\n') + result.out;
  assert.doesNotMatch(text, /SECRET/);
});

test('next holds the lock: a lock of a live process refuses it, and the lock is released after', () => {
  const root = temporaryFolder();
  const { gh } = makeWorld();
  seedRun(root, NOT_WAITING);
  writeAtomic(stateFile(root, 'lock'), String(process.pid));
  const refused = factory('next', [], { gh, root });
  assert.equal(refused.code, 2);
  assert.match(refused.errors, /lock held/);
  writeAtomic(stateFile(root, 'lock'), '999999999');
  assert.equal(factory('next', [], { gh, root }).code, 0);
  assert.equal(exists(stateFile(root, 'lock')), false);
});

// status: R-46

test('R-46: status prints active, the current ticket and stage, the cap counts, and the next step, and changes nothing', () => {
  const root = temporaryFolder();
  const { gh, calls, world } = makeWorld();
  world.runs = [{ conclusion: 'failure', createdAt: '2026-11-17T09:30:00Z' }];
  seedTicket(root, 7, { stage: 'reviewing' });
  seedRun(root, { next: { kind: 'ticket', ticket: 7, resume: true, stage: 'reviewing' } });
  seedLog(root, [
    logLine(7, 'stage', { ts: '2026-11-17T09:00:00Z', to: 'building' }),
    logLine(7, 'stage', { ts: '2026-11-17T09:05:00Z', to: 'reviewing' }),
    logLine(7, 'gate', { ts: '2026-11-17T09:30:00Z' }),
  ]);
  const before = snapshot(root);
  const result = factory('status', [], { gh, root });
  assert.equal(result.code, 0, result.errors);
  assert.match(result.out, /^run: active \(old-run/m);
  assert.match(result.out, /^current: #7, stage reviewing$/m);
  assert.match(result.out, /^caps: failed CI runs 1, active minutes 15$/m);
  assert.match(result.out, /^next: resume #7 \(stage reviewing\)$/m);
  assert.deepEqual(writeCalls(calls), []);
  assert.deepEqual(snapshot(root), before);
  assert.equal(exists(stateFile(root, 'lock')), false);
});

test('R-46: status shows a reached cap and still exits 0', () => {
  const root = temporaryFolder();
  const { gh, world } = makeWorld();
  world.runs = [1, 2, 3].map(() => ({ conclusion: 'failure', createdAt: '2026-11-17T09:30:00Z' }));
  seedTicket(root, 7);
  seedRun(root);
  seedLog(root, [logLine(7, 'stage')]);
  const result = factory('status', [], { gh, root });
  assert.equal(result.code, 0, result.errors);
  assert.match(
    result.out,
    /^caps: failed CI runs 3, active minutes 0; cap reached: 3 failed CI runs/m,
  );
});

test('R-46: status with a count that cannot be read says unknown and the reason', () => {
  const root = temporaryFolder();
  const failing = (args) => {
    if (args[0] === 'run') throw new Error('network down');
    return '';
  };
  seedTicket(root, 7);
  seedRun(root);
  seedLog(root, [logLine(7, 'stage')]);
  const result = factory('status', [], { gh: failing, root });
  assert.equal(result.code, 0, result.errors);
  assert.match(result.out, /^caps: failed CI runs unknown.*network down/m);
});

test('R-46: status of an ended run and of no run', () => {
  const root = temporaryFolder();
  assert.match(factory('status', [], { root }).out, /^run: none/m);
  seedRun(root, { ...NOT_WAITING, active: false, next: { kind: 'done' } });
  const result = factory('status', [], { root });
  assert.equal(result.code, 0, result.errors);
  assert.match(result.out, /^run: not active \(old-run/m);
  assert.match(result.out, /^current: none$/m);
  assert.match(result.out, /^next: done$/m);
  seedRun(root, { ...NOT_WAITING, active: false, stalled: true });
  assert.match(factory('status', [], { root }).out, /^run: stalled/m);
});

// stop: R-47

test('R-47: stop clears the run, keeps each ticket.json, changes no label, and writes the report with the current ticket and the resume command', () => {
  const root = temporaryFolder();
  seedTicket(root, 7, { stage: 'building' });
  seedTicket(root, 6, { stage: 'green', pr: 60 });
  seedRun(root, { only: 7 });
  seedLog(root, [logLine(6, 'stage', { to: 'green' }), logLine(7, 'stage', { to: 'building' })]);
  const before = ticketBytes(root);
  const result = factory('stop', [], { root }); // the default gh stub throws: no gh call at all
  assert.equal(result.code, 0, result.errors);
  assert.deepEqual(ticketBytes(root), before, 'each ticket.json is kept as it was');
  const run = readJson(root, 'run.json');
  assert.equal(run.active, false);
  assert.equal(run.next, null);
  assert.equal(run.runId, OLD_RUN);
  const report = readReport(root);
  assert.match(report, /^Status: stopped by the owner/m);
  assert.match(report, /## Current ticket\n+#7, stage building/);
  assert.match(report, /## Resume command\n+`\/factory 7`/);
  assert.ok(result.out.includes(`${STATE}/${REPORT}`));
  assert.ok(runLog(root, OLD_RUN).some((line) => line.event === 'stop' && line.ticket === 0));
});

test('R-47: stop with no active run says so, writes nothing, and exits 0; a second stop is the same', () => {
  const root = temporaryFolder();
  const none = factory('stop', [], { root });
  assert.equal(none.code, 0, none.errors);
  assert.match(none.out, /no active run/);
  assert.deepEqual(snapshot(root), new Map());
  seedRun(root);
  assert.equal(factory('stop', [], { root }).code, 0);
  const after = snapshot(root);
  const again = factory('stop', [], { root });
  assert.equal(again.code, 0, again.errors);
  assert.match(again.out, /no active run/);
  assert.deepEqual(snapshot(root), after);
});

test('R-47: stop clears a stalled run too', () => {
  const root = temporaryFolder();
  seedRun(root, { active: false, stalled: true });
  assert.equal(factory('stop', [], { root }).code, 0);
  assert.equal(readJson(root, 'run.json').stalled, false);
  assert.ok(exists(stateFile(root, REPORT)));
});

// report: R-29

function seedFullRun(root) {
  seedTicket(root, 5, { stage: 'done', pr: 50 });
  seedTicket(root, 6, { stage: 'green', pr: 60 });
  seedTicket(root, 7, { stage: 'building' });
  seedTicket(root, 8, { stage: 'needs-human', pr: null });
  seedRun(root, {
    stopped: { ticket: 8, reason: 'tests fail', failedSteps: ['4 comment'] },
  });
  seedLog(root, [
    logLine(5, 'stage', { to: 'done' }),
    logLine(6, 'stage', { to: 'green' }),
    logLine(7, 'stage', { to: 'building' }),
    logLine(8, 'stage', { to: 'needs-human' }),
    logLine(8, 'skip', { detail: 'step 5 metrics: skipped: task 5' }),
    logLine(9, 'skip', { detail: 'blocked by #3: no open PR (R-6)' }),
    logLine(9, 'skip', { detail: 'blocked by #3: CI of PR #4 is pending (R-6)' }),
    logLine(6, 'skip', { detail: 'issue is closed' }),
  ]);
}

test('R-29: report has the done tickets, the PRs that wait, the ticket that stopped and why, the skips, the failed hard-stop steps, and the resume command', () => {
  const root = temporaryFolder();
  seedFullRun(root);
  const result = factory('report', [], { root });
  assert.equal(result.code, 0, result.errors);
  const report = readReport(root);
  assert.equal(result.out.includes(report), true, 'the command prints the report');
  const section = (name) =>
    report
      .split(/^## /m)
      .find((part) => part.startsWith(name))
      ?.split('\n')
      .slice(1)
      .join('\n')
      .trim();
  assert.equal(section('Tickets done'), '- #5, PR #50\n- #6, PR #60');
  assert.equal(section('PRs that wait for a merge'), '- PR #60 (#6)');
  assert.equal(section('Ticket that stopped'), '- #8: tests fail');
  assert.equal(section('Tickets skipped'), '- #9: blocked by #3: CI of PR #4 is pending (R-6)');
  assert.equal(section('Hard-stop steps that failed'), '- step 4 comment');
  assert.equal(section('Current ticket'), '#7, stage building');
  assert.match(section('Resume command'), /`\/factory`/);
});

test('R-29: a report of a run with nothing to list says none in each section', () => {
  const root = temporaryFolder();
  seedRun(root);
  const result = factory('report', [], { root });
  assert.equal(result.code, 0, result.errors);
  const report = readReport(root);
  const names = [
    'Tickets done',
    'PRs that wait for a merge',
    'Ticket that stopped',
    'Tickets skipped',
    'Hard-stop steps that failed',
  ];
  for (const name of names) assert.ok(report.includes(`## ${name}\n\nnone\n`), name);
});

test('R-29: report is the same text when it runs again, and it leaves the run as it was', () => {
  const root = temporaryFolder();
  seedFullRun(root);
  factory('report', [], { root });
  const first = snapshot(root);
  const second = factory('report', [], { root, now: () => new Date('2026-11-18T10:00:00Z') });
  assert.equal(second.code, 0, second.errors);
  assert.deepEqual(snapshot(root), first);
});

test('R-29: report with no run.json fails loudly', () => {
  const root = temporaryFolder();
  const result = factory('report', [], { root });
  assert.equal(result.code, 2);
  assert.match(result.errors, /no run/);
});

test('R-29: the report holds no title or body text of a ticket, and the stop reason is redacted', () => {
  const root = temporaryFolder();
  seedTicket(root, 8, { stage: 'needs-human' });
  seedRun(root, {
    stopped: { ticket: 8, reason: 'bad token=abc123 in /Users/bob/x', failedSteps: [] },
  });
  seedLog(root, [logLine(8, 'stage')]);
  assert.equal(factory('report', [], { root }).code, 0);
  assert.doesNotMatch(readReport(root), /abc123|bob/);
  assert.match(readReport(root), /\[redacted\]/);
});

test('next, status, stop and report refuse extra words', () => {
  const root = temporaryFolder();
  seedRun(root);
  for (const command of ['next', 'status', 'stop', 'report']) {
    const result = factory(command, ['extra'], { root });
    assert.equal(result.code, 2, command);
    assert.match(result.errors, /Usage/);
  }
});

// Review round 1: S1 (only), B1 (current ticket of a resume step)

// Round 2 change: `report` is no longer in this loop. A bad `only` is tolerated by `report`, `stop`,
// `status` and hard-stop step 6 (kill switch R-47 must work). See the R2 tests below.
test('S1: run.json only that is not null or a positive integer fails next, and writes nothing', () => {
  for (const only of ['7', 0, -1, 1.5, true, [7], {}]) {
    const root = temporaryFolder();
    seedRun(root, { ...NOT_WAITING, only });
    const before = snapshot(root);
    for (const command of ['next']) {
      const result = factory(command, [], { root });
      const label = `${command} with only ${JSON.stringify(only)}`;
      assert.equal(result.code, 2, label);
      assert.match(result.errors, /run\.json: only must be a positive integer or null/, label);
      assert.deepEqual(snapshot(root), before, `${label} writes nothing`);
    }
  }
});

test('S1: run.json only as null or a positive integer is accepted by next and report', () => {
  for (const only of [null, 7]) {
    const root = temporaryFolder();
    seedRun(root, { ...NOT_WAITING, only });
    const report = factory('report', [], { root });
    assert.equal(report.code, 0, report.errors);
    assert.match(report.out, only === null ? /Scope: all tickets/ : /Scope: only #7/);
    const { gh, add } = makeWorld();
    add(makeIssue(7));
    assert.equal(factory('next', [], { gh, root }).code, 0);
  }
});

test('B1: a resume step in run.json next is the current ticket before any new log line', () => {
  const root = temporaryFolder();
  const { gh, add } = makeWorld();
  add(makeIssue(5, { labels: ['agent:in-progress'], body: 'no acceptance here' }));
  seedTicket(root, 5, { stage: 'building' });
  seedRun(root, NOT_WAITING);
  const next = factory('next', [], { gh, root });
  assert.equal(next.code, 0, next.errors);
  assert.deepEqual(readJson(root, 'run.json').next, {
    kind: 'ticket',
    ticket: 5,
    resume: true,
    stage: 'building',
  });
  assert.equal(exists(stateFile(root, 'runs', `${OLD_RUN}.jsonl`)), false, 'no log line yet');
  const noRuns = (args) => (args[0] === 'run' ? '[]' : NO_GH());
  const status = factory('status', [], { root, gh: noRuns });
  assert.equal(status.code, 0, status.errors);
  assert.match(status.out, /^current: #5, stage building$/m);
  // No run log file yet: the read-only peek counts 0 active minutes, and no cap is reached.
  assert.match(status.out, /^caps: failed CI runs 0, active minutes 0$/m);
  assert.doesNotMatch(status.out, /cap reached/);
  const stop = factory('stop', [], { root });
  assert.equal(stop.code, 0, stop.errors);
  assert.match(readReport(root), /## Current ticket\n+#5, stage building/);
});

// Review round 2: R2-1 (bad only is tolerated), R2-3 (resume step ticket)

const BAD_ONLY_WARNING = 'warning: run.json only is not valid: treated as all tickets\n';

test('R2: stop with a bad only clears the run, writes the report, warns, and exits 0', () => {
  for (const only of ['7', 0, -1, 1.5, true, [7], {}]) {
    const root = temporaryFolder();
    seedRun(root, { ...NOT_WAITING, only });
    const label = `only ${JSON.stringify(only)}`;
    const result = factory('stop', [], { root });
    assert.equal(result.code, 0, `${label}: ${result.errors}`);
    assert.equal(result.errors, BAD_ONLY_WARNING, label);
    assert.match(result.out, /resume: `\/factory`/, label);
    assert.equal(readJson(root, 'run.json').active, false, label);
    assert.match(readReport(root), /Scope: all tickets/, label);
  }
});

test('R2: report and status with a bad only warn once and show all tickets', () => {
  const root = temporaryFolder();
  seedRun(root, { ...NOT_WAITING, only: -1 });
  const report = factory('report', [], { root });
  assert.equal(report.code, 0, report.errors);
  assert.equal(report.errors, BAD_ONLY_WARNING);
  assert.match(report.out, /Scope: all tickets/);
  const status = factory('status', [], { root });
  assert.equal(status.code, 0, status.errors);
  assert.equal(status.errors, BAD_ONLY_WARNING);
  assert.match(status.out, /^run: active \(old-run, started .*, all tickets\)$/m);
});

test('R2: a valid only gives no warning, and status shows it', () => {
  const root = temporaryFolder();
  seedRun(root, { ...NOT_WAITING, only: 7 });
  const status = factory('status', [], { root });
  assert.equal(status.errors, '');
  assert.match(status.out, /, only #7\)$/m);
  const stop = factory('stop', [], { root });
  assert.equal(stop.errors, '');
  assert.match(stop.out, /resume: `\/factory 7`/);
});

test('R2: a resume step with a ticket that is not a positive integer is ignored', () => {
  for (const ticket of ['../x', '5/../5', 0, -3, 1.5, '5']) {
    const root = temporaryFolder();
    // Ticket 5 is in flight: a path that reaches its folder must still not count.
    seedTicket(root, 5, { stage: 'building' });
    seedRun(root, { ...NOT_WAITING, next: { kind: 'ticket', ticket, resume: true } });
    const status = factory('status', [], { root });
    assert.equal(status.code, 0, `${JSON.stringify(ticket)}: ${status.errors}`);
    assert.match(status.out, /^current: none$/m);
    assert.equal(factory('stop', [], { root }).code, 0);
    assert.match(readReport(root), /## Current ticket\n+none/);
  }
});
