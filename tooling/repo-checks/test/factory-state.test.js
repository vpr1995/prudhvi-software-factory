// Tests for the state commands of scripts/factory.mjs (design factory-daily-run 4.3, 4.4: R-14, R-23 to R-28, R-53, R-57).
// `gh` and `git` are stubs. No test calls the real gh or the network.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs, { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, mock, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { main } from '../scripts/factory.mjs';
import { takeOverStale, withLock } from '../scripts/lib/factory-base.mjs';
import { findForbidden, scanFolders } from '../scripts/lib/factory-skill-scan.mjs';
import {
  checkSummary,
  execute,
  FactoryError,
  reconcile,
  STAGES,
} from '../scripts/lib/factory-state.mjs';
import {
  createExclusive,
  exists,
  listFolder,
  readOptional,
  readRepositoryFile,
  writeAtomic,
} from '../scripts/lib/fs-io.mjs';

import { pathFromEnv } from './test-env.config.js';

const FACTORY = fileURLToPath(new URL('../scripts/factory.mjs', import.meta.url));
const STATE = '.claude/factory';
const LOCK = `${STATE}/lock`;
const NOW = new Date('2026-11-16T14:02:11.123Z');
const BOARD = {
  fields: [
    { id: 'F_TITLE', name: 'Title' },
    {
      id: 'F_STATUS',
      name: 'Status',
      options: [
        { id: 'o-backlog', name: 'Backlog' },
        { id: 'o-ready', name: 'Ready' },
        { id: 'o-progress', name: 'In progress' },
        { id: 'o-review', name: 'In review' },
        { id: 'o-done', name: 'Done' },
      ],
    },
  ],
};
const REPOSITORY = 'vpr1995/projects-monorepo';
const ITEMS = { items: [{ id: 'I_7', content: { number: 7, repository: REPOSITORY } }] };
const MIB = 1024 * 1024;
const roots = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const temporaryFolder = () => {
  const root = mkdtempSync(path.join(tmpdir(), 'factory-state-'));
  roots.push(root);
  return root;
};

/**
 * Context of one test: a temp repo root, a `gh` stub that records each call, a `git` stub, and
 * captured output. `answers` maps the first two `gh` words to a reply text.
 */
function makeContext({ answers = new Map(), items = ITEMS } = {}) {
  const calls = [];
  const out = [];
  const replies = new Map([
    ['project field-list', JSON.stringify(BOARD)],
    ['project item-list', JSON.stringify(items)],
    ['project view', JSON.stringify({ id: 'PVT_2' })],
    ['repo view', `${REPOSITORY}\n`],
    ...answers,
  ]);
  const gh = (args) => {
    calls.push(args);
    return replies.get(args.slice(0, 2).join(' ')) ?? '';
  };
  const git = (args) => (args[0] === 'rev-parse' ? 'abc123\n' : 'feat/7-x\n');
  const root = temporaryFolder();
  return {
    root,
    gh,
    git,
    calls,
    out,
    now: () => NOW,
    pid: process.pid,
    stdin: () => '',
    print: (text) => out.push(text),
    err: () => {},
  };
}

const stage = (context, ticket, to) => execute('stage', [String(ticket), to], context);
const readState = (context, file) => readRepositoryFile(context.root, `${STATE}/${file}`);
const ticketState = (context, ticket = 7) =>
  JSON.parse(readState(context, `${ticket}/ticket.json`));
const logLines = (context, runId = 'adhoc') =>
  readState(context, `runs/${runId}.jsonl`).trimEnd().split('\n').map(JSON.parse);
const writeCalls = (context) =>
  context.calls.filter((call) => call[1] === 'edit' || call[1] === 'item-edit');
const issueEdits = (context) => context.calls.filter((call) => call[0] === 'issue');
const withInput = (context, text) => ({ ...context, stdin: () => text });
const SUMMARY = '## Summary\n\n- one\n- two\n- three\n';

// R-24

test('R-24: an illegal stage move throws with the reason, changes no state and calls no gh', () => {
  const context = makeContext();
  stage(context, 7, 'building');
  context.calls.length = 0;
  assert.throws(
    () => stage(context, 7, 'green'),
    (error) =>
      error instanceof FactoryError &&
      /illegal stage move: building -> green/.test(error.message) &&
      /reviewing, needs-human/.test(error.message),
  );
  assert.equal(ticketState(context).stage, 'building');
  assert.deepEqual(context.calls, []);
});

test('R-24: a ticket with no state starts only at building; an unknown stage is refused', () => {
  const context = makeContext();
  assert.throws(() => stage(context, 7, 'reviewing'), /no state.*building/);
  assert.throws(() => stage(context, 7, 'constructor'), /unknown stage "constructor"/);
  assert.equal(exists(path.join(context.root, STATE, '7')), false);
});

test('R-24: the legal moves are the table of design 4.4', () => {
  const next = (name) => STAGES.get(name).next;
  assert.deepEqual(next('building'), ['reviewing', 'needs-human']);
  assert.deepEqual(next('reviewing'), ['building', 'ci', 'needs-human']);
  assert.deepEqual(next('ci'), ['building', 'green', 'needs-human']);
  assert.deepEqual(next('green'), ['building', 'done', 'needs-human']);
  assert.deepEqual(next('needs-human'), ['building']);
  assert.deepEqual(next('done'), []);
});

// 4.4 labels

test('stage building moves the labels of 4.4', () => {
  const context = makeContext();
  stage(context, 7, 'building');
  assert.deepEqual(issueEdits(context), [
    ['issue', 'edit', '7', '--add-label', 'agent:in-progress', '--remove-label', 'agent:ready'],
  ]);
});

test('each stage moves the labels of 4.4 on entry', () => {
  const context = makeContext();
  const walk = [
    ['building', ['--add-label', 'agent:in-progress', '--remove-label', 'agent:ready']],
    ['reviewing', undefined],
    ['ci', undefined],
    ['green', ['--remove-label', 'agent:in-progress']],
    ['building', ['--add-label', 'agent:in-progress', '--remove-label', 'agent:ready']],
    ['needs-human', ['--add-label', 'needs-human', '--remove-label', 'agent:in-progress']],
    ['building', ['--add-label', 'agent:in-progress', '--remove-label', 'agent:ready']],
    ['reviewing', undefined],
    ['ci', undefined],
    ['green', ['--remove-label', 'agent:in-progress']],
    ['done', undefined],
  ];
  for (const [to, flags] of walk) {
    context.calls.length = 0;
    stage(context, 7, to);
    const expected = flags === undefined ? [] : [['issue', 'edit', '7', ...flags]];
    assert.deepEqual(issueEdits(context), expected, to);
  }
});

// R-57

test('R-57: stage building sets the board Status "In progress", with IDs found by name', () => {
  const context = makeContext();
  stage(context, 7, 'building');
  assert.deepEqual(context.calls.at(-1), [
    'project',
    'item-edit',
    '--id',
    'I_7',
    '--field-id',
    'F_STATUS',
    '--project-id',
    'PVT_2',
    '--single-select-option-id',
    'o-progress',
  ]);
  const lookups = new Set(context.calls.map((call) => call.slice(0, 2).join(' ')));
  assert.ok(lookups.has('project field-list') && lookups.has('project item-list'));
});

test('R-57: each stage sets the Board Status column of 4.4', () => {
  const expected = new Map([
    ['building', 'o-progress'],
    ['reviewing', 'o-progress'],
    ['ci', 'o-review'],
    ['green', 'o-review'],
    ['needs-human', 'o-backlog'],
  ]);
  const context = makeContext();
  for (const [to, option] of expected) {
    context.calls.length = 0;
    stage(context, 7, to);
    const edit = context.calls.find((call) => call[1] === 'item-edit');
    assert.equal(edit.at(-1), option, to);
  }
  context.calls.length = 0;
  stage(context, 7, 'building');
  stage(context, 7, 'reviewing');
  stage(context, 7, 'ci');
  stage(context, 7, 'green');
  context.calls.length = 0;
  stage(context, 7, 'done');
  assert.equal(context.calls.find((call) => call[1] === 'item-edit').at(-1), 'o-done');
});

test('R-57: a ticket that is not on the board is refused and no state is written', () => {
  const context = makeContext({ items: { items: [] } });
  assert.throws(() => stage(context, 7, 'building'), /#7 is not on board 2/);
  assert.equal(exists(path.join(context.root, STATE, '7')), false);
  assert.deepEqual(writeCalls(context), []);
});

test('R-57: a Status option that the board lacks is refused', () => {
  const context = makeContext({
    answers: new Map([['project field-list', JSON.stringify({ fields: [] })]]),
  });
  assert.throws(() => stage(context, 7, 'building'), /Status option "In progress"/);
  assert.deepEqual(writeCalls(context), []);
});

// R-14, R-28

test('R-14: each move is saved, and a second call reads the saved stage', () => {
  const first = makeContext();
  stage(first, 7, 'building');
  assert.equal(ticketState(first).stage, 'building');
  const second = { ...makeContext(), root: first.root };
  stage(second, 7, 'reviewing');
  const state = ticketState(first);
  assert.equal(state.stage, 'reviewing');
  assert.equal(state.issue, 7);
  assert.equal(state.branch, 'feat/7-x');
  assert.deepEqual(
    listFolder(path.join(first.root, STATE, '7')).filter((name) => name.endsWith('.tmp')),
    [],
  );
});

test('R-14: a move keeps the keys of the stored ticket that it does not own', () => {
  const context = makeContext();
  stage(context, 7, 'building');
  const state = { ...ticketState(context), pr: 96, extra: 'kept' };
  writeAtomic(path.join(context.root, STATE, '7/ticket.json'), JSON.stringify(state));
  stage(context, 7, 'reviewing');
  assert.deepEqual(ticketState(context), { ...state, stage: 'reviewing' });
});

test('R-28: each stage move appends one run log line', () => {
  const context = makeContext();
  stage(context, 7, 'building');
  assert.equal(logLines(context).length, 1);
  stage(context, 7, 'reviewing');
  stage(context, 7, 'needs-human');
  const lines = logLines(context);
  assert.equal(lines.length, 3);
  assert.deepEqual(lines[0], {
    ts: '2026-11-16T14:02:11Z',
    ticket: 7,
    event: 'stage',
    from: null,
    to: 'building',
    detail: 'labels +agent:in-progress -agent:ready; board In progress',
  });
  assert.deepEqual(
    lines.slice(1).map((line) => [line.event, line.from, line.to]),
    [
      ['stage', 'building', 'reviewing'],
      ['stage', 'reviewing', 'needs-human'],
    ],
  );
});

test('R-28: a refused move appends no line; the log file is runs/<runId>.jsonl of run.json', () => {
  const context = makeContext();
  writeAtomic(path.join(context.root, STATE, 'run.json'), JSON.stringify({ runId: 'run-9' }));
  stage(context, 7, 'building');
  assert.throws(() => stage(context, 7, 'done'));
  assert.equal(logLines(context, 'run-9').length, 1);
  assert.equal(exists(path.join(context.root, STATE, 'runs/adhoc.jsonl')), false);
});

test('a run.json with a runId that is not a plain name is refused', () => {
  const context = makeContext();
  writeAtomic(path.join(context.root, STATE, 'run.json'), JSON.stringify({ runId: '../x' }));
  assert.throws(() => stage(context, 7, 'building'), /run\.json.*runId/);
});

// R-23

const githubAnswers = ({ labels = [], prs = [], checks = [] }) =>
  new Map([
    ['issue view', JSON.stringify({ labels: labels.map((name) => ({ name })) })],
    ['pr list', JSON.stringify(prs)],
    ['pr checks', JSON.stringify(checks)],
  ]);

function storedTicket(stageName) {
  const context = makeContext();
  stage(context, 7, 'building');
  const state = { ...ticketState(context), stage: stageName };
  writeAtomic(path.join(context.root, STATE, '7/ticket.json'), JSON.stringify(state));
  return context;
}

function reconcileWith(stageName, github, items = ITEMS) {
  const context = storedTicket(stageName);
  const gh = makeContext({ answers: githubAnswers(github), items }).gh;
  context.out.length = 0;
  context.calls.length = 0;
  const result = reconcile({ ...context, gh, ticket: '7' });
  return { context, result };
}

test('R-23: a mismatch prints both values and uses GitHub', () => {
  const { context, result } = reconcileWith('reviewing', {
    prs: [{ number: 96, state: 'MERGED' }],
  });
  assert.equal(result, 'done');
  assert.match(context.out.join(''), /local=reviewing/);
  assert.match(context.out.join(''), /github=done/);
  assert.equal(ticketState(context).stage, 'done');
  assert.deepEqual(logLines(context).at(-1), {
    ts: '2026-11-16T14:02:11Z',
    ticket: 7,
    event: 'reconcile',
    from: 'reviewing',
    to: 'done',
    detail: 'github',
  });
});

test('R-23: the order of 4.4: merged, needs-human label, green CI, other CI', () => {
  const open = [{ number: 96, state: 'OPEN' }];
  const pass = [{ name: 'a', state: 'SUCCESS', bucket: 'pass' }];
  const cases = [
    [{ prs: [{ number: 96, state: 'MERGED' }], labels: ['needs-human'] }, 'done'],
    [{ prs: open, labels: ['needs-human'], checks: pass }, 'needs-human'],
    [{ prs: open, checks: pass }, 'green'],
    [
      { prs: open, checks: [...pass, { name: 'b', state: 'SKIPPED', bucket: 'skipping' }] },
      'green',
    ],
    [{ prs: open, checks: [...pass, { name: 'b', state: 'PENDING', bucket: 'pending' }] }, 'ci'],
    [{ prs: open, checks: [{ name: 'b', state: 'FAILURE', bucket: 'fail' }] }, 'ci'],
    [{ prs: open, checks: [] }, 'ci'],
    [{ prs: open, checks: [{ name: 'a', state: 'SKIPPED', bucket: 'skipping' }] }, 'ci'],
    [{ prs: [{ number: 90, state: 'CLOSED' }, ...open], checks: pass }, 'green'],
  ];
  for (const [github, expected] of cases) {
    assert.equal(reconcileWith('building', github).result, expected, JSON.stringify(github));
  }
});

const REPO_URL = 'https://github.com/vpr1995/prudhvi-software-factory';
const ciPass = {
  name: 'knip',
  state: 'SUCCESS',
  bucket: 'pass',
  link: `${REPO_URL}/actions/runs/44024429743/job/133841691172`,
  startedAt: '2026-11-17T05:29:18Z',
  workflow: 'ci',
};
const codeql = {
  name: 'CodeQL',
  state: 'SUCCESS',
  bucket: 'pass',
  link: `${REPO_URL}/runs/133841448302`,
  startedAt: '2026-11-17T05:29:38Z',
  workflow: '',
};
const ciCancel = {
  name: 'matrix.project.name',
  state: 'CANCELLED',
  bucket: 'cancel',
  link: `${REPO_URL}/actions/runs/44024429640/job/133841274038`,
  startedAt: '2026-11-17T05:29:09Z',
  workflow: 'ci',
};

test('R-23: a cancelled duplicate check is ignored when a later check of its workflow passed', () => {
  const open = [{ number: 96, state: 'OPEN' }];
  const cases = [
    // PR 114 shape: the cancelled duplicate ci run started before the passing ci checks.
    [[ciPass, codeql, ciCancel, { ...ciPass, name: 'gitleaks', workflow: 'secrets' }], 'green'],
    // A fully cancelled ci run is not green.
    [[codeql, ciCancel], 'ci'],
    // A later pass of another workflow does not cover the cancel.
    [[codeql, { ...ciPass, workflow: 'secrets' }, ciCancel], 'ci'],
    // The pass started before the cancel.
    [[codeql, { ...ciPass, startedAt: '2026-11-17T05:29:00Z' }, ciCancel], 'ci'],
    // Missing fields give no match.
    [[codeql, { name: 'knip', state: 'SUCCESS', bucket: 'pass' }, { bucket: 'cancel' }], 'ci'],
    // A later pass in the same run does not cover a cancelled job of that run.
    [
      [codeql, { ...ciPass, link: ciCancel.link, startedAt: '2026-11-17T05:30:00Z' }, ciCancel],
      'ci',
    ],
    // An empty workflow is no key: a later pass of an external check does not cover the cancel.
    [
      [
        { ...codeql, link: `${REPO_URL}/actions/runs/555/job/1` },
        { ...ciCancel, workflow: '' },
      ],
      'ci',
    ],
    // A cancel with no link has no run id.
    [[ciPass, codeql, { ...ciCancel, link: undefined }], 'ci'],
    // A pass with no run id in its link does not cover the cancel.
    [[codeql, { ...ciPass, link: codeql.link }, ciCancel], 'ci'],
  ];
  for (const [checks, expected] of cases) {
    assert.equal(
      reconcileWith('building', { prs: open, checks }).result,
      expected,
      JSON.stringify(checks),
    );
  }
});

test('R-23: no GitHub signal keeps the stored stage and prints nothing', () => {
  const { context, result } = reconcileWith('reviewing', {});
  assert.equal(result, 'reviewing');
  assert.deepEqual(context.out, []);
  assert.equal(ticketState(context).stage, 'reviewing');
  assert.equal(logLines(context).length, 1);
});

test('R-23: the same stage on both sides prints nothing', () => {
  const { context, result } = reconcileWith('needs-human', { labels: ['needs-human'] });
  assert.equal(result, 'needs-human');
  assert.deepEqual(context.out, []);
});

const boardItems = (status) => ({
  items: [{ id: 'I_7', status, content: { number: 7, repository: REPOSITORY } }],
});
const READY = { labels: ['agent:ready'] };

test('R-57: agent:ready with no stage expects board Status Ready; a mismatch prints both values', () => {
  const { context, result } = reconcileWith('needs-human', READY, boardItems('Backlog'));
  assert.equal(result, 'needs-human');
  assert.match(context.out.join(''), /Backlog/);
  assert.match(context.out.join(''), /Ready/);
  assert.match(context.out.join(''), /using github/);
  assert.equal(ticketState(context).stage, 'needs-human');
  assert.deepEqual(writeCalls(context), []);
  assert.deepEqual(logLines(context).at(-1), {
    ts: '2026-11-16T14:02:11Z',
    ticket: 7,
    event: 'reconcile',
    from: 'needs-human',
    to: 'needs-human',
    detail: 'github: board Backlog, expected Ready',
  });
});

test('R-57: agent:ready with board Status Ready prints nothing', () => {
  const { context, result } = reconcileWith('needs-human', READY, boardItems('Ready'));
  assert.equal(result, 'needs-human');
  assert.deepEqual(context.out, []);
  assert.equal(logLines(context).length, 1);
});

test('R-57: agent:ready on a ticket that is not on the board is a mismatch', () => {
  const { context } = reconcileWith('needs-human', READY, { items: [] });
  assert.match(context.out.join(''), /board=none/);
});

test('R-57: agent:ready does not hide a stage that GitHub gives (open PR, needs-human)', () => {
  const open = [{ number: 96, state: 'OPEN' }];
  const pass = [{ name: 'a', state: 'SUCCESS', bucket: 'pass' }];
  const backlog = boardItems('Backlog');
  assert.equal(
    reconcileWith('building', { ...READY, prs: open, checks: pass }, backlog).result,
    'green',
  );
  assert.equal(
    reconcileWith('building', { labels: ['agent:ready', 'needs-human'] }, backlog).result,
    'needs-human',
  );
});

test('R-23: a ticket with no local state has nothing to reconcile', () => {
  const context = makeContext({ answers: githubAnswers({ labels: ['needs-human'] }) });
  assert.equal(reconcile({ ...context, ticket: '7' }), undefined);
  assert.deepEqual(context.calls, []);
});

// R-53

const lockPath = (context) => path.join(context.root, LOCK);

test('R-53: a lock of a live process makes the command fail and keeps the lock', () => {
  const context = makeContext();
  writeAtomic(lockPath(context), String(process.ppid));
  assert.throws(
    () => stage(context, 7, 'building'),
    (error) =>
      error instanceof FactoryError &&
      error.message.includes(`pid ${String(process.ppid)}`) &&
      error.message.includes('lock'),
  );
  assert.equal(readOptional(lockPath(context)), String(process.ppid));
  assert.deepEqual(context.calls, []);
  assert.equal(exists(path.join(context.root, STATE, '7')), false);
});

test('R-53: a lock of a dead process is removed and the command runs', () => {
  const context = makeContext();
  const dead = spawnSync(process.execPath, ['-e', '']).pid;
  writeAtomic(lockPath(context), String(dead));
  stage(context, 7, 'building');
  assert.equal(ticketState(context).stage, 'building');
  assert.equal(exists(lockPath(context)), false);
});

test('R-53: the lock is written with the pid and released, also after a refused move', () => {
  const context = makeContext();
  stage(context, 7, 'building');
  assert.equal(exists(lockPath(context)), false);
  assert.throws(() => stage(context, 7, 'done'));
  assert.equal(exists(lockPath(context)), false);
});

test('R-53: a lock with no valid pid is not removed; the message names the file', () => {
  const context = makeContext();
  writeAtomic(lockPath(context), '');
  assert.throws(() => stage(context, 7, 'building'), /no valid pid.*lock/);
  assert.equal(exists(lockPath(context)), true);
});

test('R-53: the writing commands note, round and findings take the lock too', () => {
  const live = String(process.ppid);
  for (const [command, words, input] of [
    ['note', ['7', 'build'], SUMMARY],
    ['round', ['start'], ''],
    ['findings', ['add'], 'Nit | a.mjs:1 | style | r\n'],
    ['findings', ['set', 'F1', 'fixed'], ''],
  ]) {
    const context = withInput(makeContext(), input);
    writeAtomic(lockPath(context), live);
    assert.throws(() => execute(command, words, context), /lock/, command);
  }
});

// R-26

test('R-26: a step summary starts with "## Summary" and has 3 to 5 bullets', () => {
  const bullets = (count) =>
    `## Summary\n\n${Array.from({ length: count }, (_, index) => `- item ${String(index)}`).join('\n')}\n`;
  assert.match(checkSummary(bullets(2)), /3 to 5 bullets.*found 2/);
  assert.equal(checkSummary(bullets(3)), undefined);
  assert.equal(checkSummary(bullets(5)), undefined);
  assert.match(checkSummary(bullets(6)), /3 to 5 bullets.*found 6/);
  assert.match(checkSummary('- a\n- b\n- c\n'), /start with "## Summary"/);
  assert.match(checkSummary('\n## Summary\n- a\n- b\n- c\n'), /start with "## Summary"/);
  assert.match(checkSummary('# Summary\n- a\n- b\n- c\n'), /start with "## Summary"/);
  assert.match(checkSummary(''), /start with "## Summary"/);
});

test('R-26: bullets after the next heading do not count; detail below is allowed', () => {
  assert.equal(checkSummary(`${SUMMARY}\n## Detail\n\n- x\n- y\n- z\n- w\n- v\n- u\n`), undefined);
  assert.match(checkSummary('## Summary\n\n- a\n- b\n\n## Detail\n\n- c\n- d\n'), /found 2/);
});

test('R-26: note stores a valid summary and read prints it', () => {
  const context = makeContext();
  execute('note', ['7', 'build'], withInput(context, SUMMARY));
  assert.equal(readState(context, '7/steps/build.md'), SUMMARY);
  context.out.length = 0;
  execute('read', ['7', 'build'], context);
  assert.equal(execute('read', ['7', 'build'], context), SUMMARY);
});

test('R-26: note refuses a bad summary and stores nothing', () => {
  const context = makeContext();
  assert.throws(
    () => execute('note', ['7', 'build'], withInput(context, '## Summary\n- a\n')),
    /3 to 5/,
  );
  assert.equal(exists(path.join(context.root, STATE, '7/steps/build.md')), false);
});

test('read: a step with no summary fails; "pre-pr" prints the findings of the ticket', () => {
  const context = makeContext();
  assert.throws(() => execute('read', ['7', 'build'], context), /no summary.*build/);
  execute('round', ['7', 'start'], context);
  execute('findings', ['7', 'add'], withInput(context, 'Important | a.mjs:3 | null deref | why\n'));
  assert.match(
    execute('read', ['7', 'pre-pr'], context),
    /^F1 \| 1 \| Important \| a\.mjs:3 \| null deref \| open \| why$/m,
  );
});

test('a ticket number or a step name that is not a plain name is refused', () => {
  const context = makeContext();
  assert.throws(() => execute('stage', ['../7', 'building'], context), /ticket number/);
  assert.throws(() => execute('stage', ['0', 'building'], context), /ticket number/);
  assert.throws(() => execute('note', ['7', '../x'], withInput(context, SUMMARY)), /step name/);
  assert.throws(() => execute('read', ['7', 'A b'], context), /step name/);
  assert.throws(() => execute('bogus', [], context), /Usage/);
  assert.equal(listFolder(path.join(context.root, STATE)).length, 0);
});

// R-27

const roundFile = (context, folder, number) =>
  JSON.parse(readState(context, `${folder}/pre-pr/round-${String(number)}.json`));

test('R-27: round start numbers the rounds of a ticket, with sha and ts', () => {
  const context = makeContext();
  assert.equal(execute('round', ['7', 'start'], context), 'round 1\n');
  assert.equal(execute('round', ['7', 'start'], context), 'round 2\n');
  assert.deepEqual(roundFile(context, '7', 2), { sha: 'abc123', ts: '2026-11-16T14:02:11Z' });
});

test('R-27: each ticket has its own pre-pr folder', () => {
  const context = makeContext();
  execute('round', ['7', 'start'], context);
  execute('round', ['7', 'start'], context);
  assert.equal(execute('round', ['8', 'start'], context), 'round 1\n');
  execute('findings', ['7', 'add'], withInput(context, 'Nit | a.mjs:1 | style | r\n'));
  assert.equal(execute('findings', ['8', 'list'], context), '');
  assert.match(execute('findings', ['7', 'list'], context), /^F1 \| 2 \| Nit/);
});

test('R-27: with no ticket, round and findings use the ad hoc folder the script picks', () => {
  const context = makeContext();
  assert.equal(execute('round', ['start'], context), 'round 1\n');
  assert.equal(roundFile(context, 'adhoc', 1).sha, 'abc123');
  execute('findings', ['add'], withInput(context, 'Nit | a.mjs:1 | style | r\n'));
  assert.match(readState(context, 'adhoc/pre-pr/findings.md'), /^F1 \| 1 \| Nit/);
  assert.match(execute('findings', ['list'], context), /^F1 /);
  assert.equal(exists(path.join(context.root, STATE, '7')), false);
});

test('R-27: round start --new starts a new pre-pr run at round 1 with no old rows', () => {
  const context = makeContext();
  execute('round', ['start'], context);
  execute('round', ['start'], context);
  execute('findings', ['add'], withInput(context, 'Nit | a.mjs:1 | style | r\n'));
  assert.equal(execute('round', ['start', '--new'], context), 'round 1\n');
  assert.deepEqual(listFolder(path.join(context.root, STATE, 'adhoc/pre-pr')), ['round-1.json']);
  assert.equal(execute('findings', ['list'], context), '');
});

// findings

test('findings add: the script assigns id, round and status "open"', () => {
  const context = makeContext();
  execute('round', ['7', 'start'], context);
  const input = 'Important | a.mjs:3 | null deref | bad | with pipe\nNit | b.mjs:9 | naming | x\n';
  const result = execute('findings', ['7', 'add'], withInput(context, input));
  assert.equal(result, 'F1 added\nF2 added\n');
  assert.equal(
    execute('findings', ['7', 'list'], context),
    'F1 | 1 | Important | a.mjs:3 | null deref | open | bad | with pipe\nF2 | 1 | Nit | b.mjs:9 | naming | open | x\n',
  );
});

test('findings add: a matching fixed row reopens, an open or rejected match is skipped', () => {
  const context = makeContext();
  execute('round', ['7', 'start'], context);
  const add = (text) => execute('findings', ['7', 'add'], withInput(context, text));
  add(
    'Important | a.mjs:3 | null deref | r\nNit | b.mjs:9 | naming | r\nNit | c.mjs:1 | dup | r\n',
  );
  execute('findings', ['7', 'set', 'F1', 'fixed'], context);
  execute('findings', ['7', 'set', 'F2', 'rejected'], context);
  execute('round', ['7', 'start'], context);
  const result = add(
    'Important | a.mjs:3 | Null Deref | again\nNit | b.mjs:9 | naming | again\nNit | c.mjs:1 | dup | again\nNit | a.mjs:3 | other class | new\n',
  );
  assert.equal(result, 'F1 reopened\nF2 skipped (rejected)\nF3 skipped (open)\nF4 added\n');
  const rows = execute('findings', ['7', 'list'], context).trimEnd().split('\n');
  assert.equal(rows[0], 'F1 | 1 | Important | a.mjs:3 | null deref | open | r');
  assert.equal(rows[1], 'F2 | 1 | Nit | b.mjs:9 | naming | rejected | r');
  assert.equal(rows[3], 'F4 | 2 | Nit | a.mjs:3 | other class | open | new');
});

test('findings add: a bad row stores nothing; no round started is an error', () => {
  const context = makeContext();
  const add = (text) => execute('findings', ['7', 'add'], withInput(context, text));
  assert.throws(() => add('Nit | a.mjs:1 | style | r\n'), /no round/);
  execute('round', ['7', 'start'], context);
  assert.throws(
    () => add('Nit | a.mjs:1 | style | r\nHigh | a.mjs:2 | x | r\n'),
    /line 2.*severity/,
  );
  assert.throws(() => add('Nit | a.mjs | x | r\n'), /file:line/);
  assert.throws(() => add('Nit | a.mjs:2 | x\n'), /4 fields/);
  assert.throws(() => add(''), /no rows/);
  assert.equal(execute('findings', ['7', 'list'], context), '');
});

test('findings set: changes the status; an unknown id or status is refused', () => {
  const context = makeContext();
  execute('round', ['7', 'start'], context);
  execute('findings', ['7', 'add'], withInput(context, 'Nit | a.mjs:1 | style | r\n'));
  assert.equal(execute('findings', ['7', 'set', 'F1', 'fixed'], context), 'F1 fixed\n');
  assert.match(execute('findings', ['7', 'list'], context), /\| fixed \| r$/m);
  assert.throws(() => execute('findings', ['7', 'set', 'F9', 'fixed'], context), /no finding F9/);
  assert.throws(
    () => execute('findings', ['7', 'set', 'F1', 'done'], context),
    /open, fixed, rejected/,
  );
});

// Review round 1 fixes

test('R-53: a takeover that finds another holder in the lock refuses and keeps that lock', () => {
  const context = makeContext();
  const file = lockPath(context);
  writeAtomic(file, String(process.ppid));
  assert.throws(() => takeOverStale(context, '99999999'), /lock taken by another process/);
  assert.equal(readOptional(file), String(process.ppid));
  assert.deepEqual(
    listFolder(path.dirname(file)).filter((name) => name.includes('.stale.')),
    [],
  );
});

test('R-53: a takeover of a dead holder leaves the lock of the new pid and no stale file', () => {
  const context = makeContext();
  const dead = spawnSync(process.execPath, ['-e', '']).pid;
  writeAtomic(lockPath(context), String(dead));
  takeOverStale(context, String(dead));
  assert.equal(readOptional(lockPath(context)), String(process.pid));
  assert.deepEqual(
    listFolder(path.dirname(lockPath(context))).filter((name) => name.includes('.stale.')),
    [],
  );
});

test('R-53: a takeover with no lock file left takes the lock with an exclusive create', () => {
  const context = makeContext();
  takeOverStale(context, '99999999');
  assert.equal(readOptional(lockPath(context)), String(process.pid));
});

test('R-53: the release keeps a lock whose content is no longer the pid of the command', () => {
  const context = makeContext();
  withLock(context, () => writeAtomic(lockPath(context), '99999999'));
  assert.equal(readOptional(lockPath(context)), '99999999');
});

test('R-53: stdin is read and checked before the lock is taken', () => {
  const context = makeContext();
  const reads = [];
  const stdin = (text) => () => {
    reads.push(exists(lockPath(context)));
    return text;
  };
  execute('note', ['7', 'build'], { ...context, stdin: stdin(SUMMARY) });
  execute('round', ['7', 'start'], context);
  execute('findings', ['7', 'add'], { ...context, stdin: stdin('Nit | a.mjs:1 | s | r\n') });
  assert.deepEqual(reads, [false, false]);
  writeAtomic(lockPath(context), String(process.ppid));
  assert.throws(
    () => execute('note', ['7', 'x'], { ...context, stdin: stdin('bad') }),
    /start with "## Summary"/,
  );
  assert.throws(
    () => execute('findings', ['7', 'add'], { ...context, stdin: stdin('bad row') }),
    /4 fields/,
  );
});

test('stdin of more than 1 MiB is refused with the reason and nothing is stored', () => {
  const context = makeContext();
  const big = (head) => `${head}${'x'.repeat(MIB)}`;
  assert.throws(
    () => execute('note', ['7', 'build'], withInput(context, big(SUMMARY))),
    /stdin.*1 MiB/,
  );
  execute('round', ['7', 'start'], context);
  assert.throws(
    () => execute('findings', ['7', 'add'], withInput(context, big('Nit | a.mjs:1 | style | r\n'))),
    /stdin.*1 MiB/,
  );
  assert.equal(exists(path.join(context.root, STATE, '7/steps/build.md')), false);
  assert.equal(execute('findings', ['7', 'list'], context), '');
  assert.equal(exists(lockPath(context)), false);
});

test('R-27: round start --new with a failing git wipes nothing', () => {
  const context = makeContext();
  execute('round', ['7', 'start'], context);
  execute('round', ['7', 'start'], context);
  execute('findings', ['7', 'add'], withInput(context, 'Nit | a.mjs:1 | style | r\n'));
  const folder = path.join(context.root, STATE, '7/pre-pr');
  const before = listFolder(folder).toSorted();
  const failing = {
    ...context,
    git: () => {
      throw new Error('git broke');
    },
  };
  assert.throws(() => execute('round', ['7', 'start', '--new'], failing), /git broke/);
  assert.deepEqual(listFolder(folder).toSorted(), before);
  assert.match(execute('findings', ['7', 'list'], context), /^F1 /);
  assert.equal(exists(lockPath(context)), false);
});

test('a run.json with null or another value that is not an object is refused with the reason', () => {
  for (const text of ['null', '7', '"x"']) {
    const context = makeContext();
    writeAtomic(path.join(context.root, STATE, 'run.json'), text);
    assert.throws(
      () => stage(context, 7, 'building'),
      (error) => error instanceof FactoryError && /run\.json.*object/.test(error.message),
      text,
    );
  }
});

test('R-57: a board item with the same number from another repository is not edited', () => {
  const other = { id: 'I_X', content: { number: 7, repository: 'someone/else' } };
  const own = { id: 'I_7', content: { number: 7, repository: REPOSITORY } };
  const onlyOther = makeContext({ items: { items: [other] } });
  assert.throws(() => stage(onlyOther, 7, 'building'), /#7 is not on board 2/);
  assert.deepEqual(writeCalls(onlyOther), []);
  assert.equal(exists(path.join(onlyOther.root, STATE, '7')), false);
  const both = makeContext({ items: { items: [other, own] } });
  stage(both, 7, 'building');
  assert.equal(both.calls.find((call) => call[1] === 'item-edit')[3], 'I_7');
});

test('R-57: the repository comes from gh once; a reply with no name is refused', () => {
  const context = makeContext();
  stage(context, 7, 'building');
  assert.equal(context.calls.filter((call) => call[0] === 'repo').length, 1);
  const empty = makeContext({ answers: new Map([['repo view', '']]) });
  assert.throws(() => stage(empty, 7, 'building'), /repository/);
  assert.deepEqual(writeCalls(empty), []);
});

// CLI

const GH_STUB = `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
appendFileSync(path.join(__dirname, 'calls.log'), JSON.stringify(args) + '\\n');
const key = args.slice(0, 2).join(' ');
const replies = {
  'project field-list': ${JSON.stringify(JSON.stringify(BOARD))},
  'project item-list': ${JSON.stringify(JSON.stringify(ITEMS))},
  'project view': '{"id":"PVT_2"}',
  'repo view': ${JSON.stringify(`${REPOSITORY}\n`)},
};
process.stdout.write(replies[key] ?? '');
`;

function cliEnvironment() {
  const folder = temporaryFolder();
  writeAtomic(path.join(folder, 'gh'), GH_STUB);
  chmodSync(path.join(folder, 'gh'), 0o755);
  const repository = temporaryFolder();
  const git = (...args) => spawnSync('git', args, { cwd: repository });
  git('init', '-q');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-qm', 'init');
  const env = { PATH: `${folder}${path.delimiter}${pathFromEnv()}` };
  return {
    repository,
    run: (...args) =>
      spawnSync(process.execPath, [FACTORY, ...args], { cwd: repository, env, encoding: 'utf8' }),
    calls: () => (readOptional(path.join(folder, 'calls.log')) ?? '').trimEnd().split('\n'),
  };
}

test('CLI: an illegal move exits non-zero and prints the reason; a legal move exits 0', () => {
  const environment = cliEnvironment();
  const bad = environment.run('stage', '7', 'green');
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /illegal stage move: none -> green|no state/);
  const good = environment.run('stage', '7', 'building');
  assert.equal(good.status, 0, good.stderr);
  assert.match(good.stdout, /#7: none -> building/);
  assert.equal(
    JSON.parse(readRepositoryFile(environment.repository, `${STATE}/7/ticket.json`)).stage,
    'building',
  );
  assert.ok(environment.calls().some((call) => call.includes('o-progress')));
  const again = environment.run('stage', '7', 'building');
  assert.notEqual(again.status, 0);
  assert.match(again.stderr, /illegal stage move: building -> building/);
});

test('CLI: a lock of a live process exits non-zero', () => {
  const environment = cliEnvironment();
  writeAtomic(path.join(environment.repository, LOCK), String(process.ppid));
  const result = environment.run('stage', '7', 'building');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /lock held by pid/);
});

test('CLI: note reads stdin, and main reports a refusal through the error stream', () => {
  const environment = cliEnvironment();
  const stored = spawnSync(process.execPath, [FACTORY, 'note', '7', 'build'], {
    cwd: environment.repository,
    input: SUMMARY,
    encoding: 'utf8',
  });
  assert.equal(stored.status, 0, stored.stderr);
  assert.equal(readRepositoryFile(environment.repository, `${STATE}/7/steps/build.md`), SUMMARY);
  const errors = [];
  const code = main(['node', 'factory.mjs', 'stage', '7', 'reviewing'], {
    ...makeContext(),
    err: (text) => errors.push(text),
  });
  assert.notEqual(code, 0);
  assert.match(errors.join(''), /no state/);
});

// Review round 2 fixes

const staleNames = (context) =>
  listFolder(path.dirname(lockPath(context))).filter((name) => name.includes('.stale.'));

test('R-53: a failed restore keeps the stale file and tells the owner two holders can exist', () => {
  const context = makeContext();
  const file = lockPath(context);
  const stale = `${file}.stale.${String(context.pid)}`;
  writeAtomic(file, '99999999');
  // Another process creates the lock in the window between the rename and the restore.
  const realRename = fs.renameSync;
  mock.method(fs, 'renameSync', (from, to) => {
    realRename(from, to);
    createExclusive(file, String(process.ppid));
  });
  syncBuiltinESMExports();
  try {
    assert.throws(
      () => takeOverStale(context, '12345'),
      (error) =>
        error instanceof FactoryError &&
        error.message.includes(`${STATE}/lock`) &&
        error.message.includes(`${STATE}/lock.stale.${String(context.pid)}`) &&
        /two holders/i.test(error.message) &&
        /owner/.test(error.message),
    );
  } finally {
    mock.restoreAll();
    syncBuiltinESMExports();
  }
  assert.equal(readOptional(stale), '99999999');
  assert.equal(readOptional(file), String(process.ppid));
});

test('R-53: a stale file left by an earlier crash does not break a later takeover', () => {
  const context = makeContext();
  const dead = spawnSync(process.execPath, ['-e', '']).pid;
  writeAtomic(lockPath(context), String(dead));
  writeAtomic(`${lockPath(context)}.stale.${String(context.pid)}`, 'left by a crash');
  takeOverStale(context, String(dead));
  assert.equal(readOptional(lockPath(context)), String(process.pid));
  assert.deepEqual(staleNames(context), []);
});

const READ_STDIN = `import { readStdin } from ${JSON.stringify(
  new URL('../scripts/lib/fs-io.mjs', import.meta.url).href,
)};
const limit = process.argv[1] === undefined ? undefined : Number(process.argv[1]);
process.stdout.write(String(readStdin(limit).length));
`;
const readStdinIn = (input, limit) =>
  spawnSync(
    process.execPath,
    ['--input-type=module', '-e', READ_STDIN, ...(limit === undefined ? [] : [String(limit)])],
    { input, encoding: 'utf8' },
  );

test('stdin is read with a byte limit and stops at the limit', () => {
  const result = readStdinIn('x'.repeat(2 * MIB), MIB + 1);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, String(MIB + 1));
});

test('stdin under the limit is read whole, with no limit it is read whole, empty gives empty', () => {
  assert.equal(readStdinIn('abc', MIB + 1).stdout, '3');
  assert.equal(readStdinIn('x'.repeat(2 * MIB)).stdout, String(2 * MIB));
  const empty = readStdinIn('', MIB + 1);
  assert.equal(empty.status, 0, empty.stderr);
  assert.equal(empty.stdout, '0');
});

test('CLI: note refuses more than 1 MiB on stdin and stores nothing', () => {
  const environment = cliEnvironment();
  const result = spawnSync(process.execPath, [FACTORY, 'note', '7', 'build'], {
    cwd: environment.repository,
    input: `${SUMMARY}${'x'.repeat(2 * MIB)}`,
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /stdin is bigger than 1 MiB/);
  assert.equal(exists(path.join(environment.repository, STATE, '7/steps/build.md')), false);
});

// R-25

test('R-25: the scan flags the state folder and direct comments, with file and line', () => {
  assert.deepEqual(findForbidden('a.md', 'ok\nread `.claude/factory/7/ticket.json`\n'), [
    { file: 'a.md', line: 2, rule: 'names the state folder' },
  ]);
  assert.deepEqual(findForbidden('a.md', 'gh pr comment 5 --body x\ngh  issue comment 6'), [
    { file: 'a.md', line: 1, rule: 'calls gh pr comment or gh issue comment' },
    { file: 'a.md', line: 2, rule: 'calls gh pr comment or gh issue comment' },
  ]);
  assert.deepEqual(
    findForbidden('a.md', 'node tooling/repo-checks/scripts/factory.mjs note 5 x'),
    [],
  );
});

test('R-25: a folder scan reports each bad file with file:line and passes a clean file', () => {
  const root = temporaryFolder();
  const files = {
    '.claude/skills/state/SKILL.md': 'intro\nRead `.claude/factory/7/ticket.json` now.\n',
    '.claude/skills/pr/SKILL.md': 'gh pr comment 5 --body x\n',
    '.claude/agents/issue.md': 'a\nb\nc\ngh issue comment 6 --body y\n',
    '.claude/agents/clean.md': 'node tooling/repo-checks/scripts/factory.mjs note 5 x\n',
  };
  for (const [file, text] of Object.entries(files)) writeAtomic(path.join(root, file), text);
  const hits = scanFolders(root, ['.claude/skills', '.claude/agents']).map(
    ({ file, line, rule }) => `${file}:${String(line)} ${rule}`,
  );
  assert.deepEqual(hits.toSorted(), [
    '.claude/agents/issue.md:4 calls gh pr comment or gh issue comment',
    '.claude/skills/pr/SKILL.md:1 calls gh pr comment or gh issue comment',
    '.claude/skills/state/SKILL.md:2 names the state folder',
  ]);
});

// The real-repo scan is in test/factory-skill-paths.test.js (task 4a, #108), with the work-ticket delete.
