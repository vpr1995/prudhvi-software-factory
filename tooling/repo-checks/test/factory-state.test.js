// Tests for the state commands of scripts/factory.mjs (design factory-daily-run 4.3, 4.4: R-14, R-23 to R-28, R-53, R-57).
// `gh` and `git` are stubs. No test calls the real gh or the network.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { main } from '../scripts/factory.mjs';
import {
  checkSummary,
  execute,
  FactoryError,
  reconcile,
  STAGES,
} from '../scripts/lib/factory-state.mjs';
import {
  exists,
  listFilesRecursive,
  listFolder,
  readOptional,
  readRepositoryFile,
  writeAtomic,
} from '../scripts/lib/fs-io.mjs';

import { pathFromEnv } from './test-env.config.js';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
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
const ITEMS = { items: [{ id: 'I_7', content: { number: 7 } }] };
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

function reconcileWith(stageName, github) {
  const context = storedTicket(stageName);
  const gh = makeContext({ answers: githubAnswers(github) }).gh;
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
    [{ prs: [{ number: 90, state: 'CLOSED' }, ...open], checks: pass }, 'green'],
  ];
  for (const [github, expected] of cases) {
    assert.equal(reconcileWith('building', github).result, expected, JSON.stringify(github));
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
  for (const [command, words] of [
    ['note', ['7', 'build']],
    ['round', ['start']],
    ['findings', ['add']],
    ['findings', ['set', 'F1', 'fixed']],
  ]) {
    const context = withInput(makeContext(), SUMMARY);
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

// R-25

const FORBIDDEN = [
  { rule: 'names the state folder', pattern: /\.claude\/factory/ },
  { rule: 'calls gh pr comment or gh issue comment', pattern: /gh\s+(?:pr|issue)\s+comment/ },
];

/** @returns {{ file: string, line: number, rule: string }[]} Each line of the text that breaks a rule. */
function findForbidden(file, text) {
  return text.split('\n').flatMap((line, index) =>
    FORBIDDEN.filter(({ pattern }) => pattern.test(line)).map(({ rule }) => ({
      file,
      line: index + 1,
      rule,
    })),
  );
}

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

test('R-25: no skill or agent file names .claude/factory or calls gh pr comment or gh issue comment', () => {
  const files = ['.claude/skills', '.claude/agents'].flatMap((folder) =>
    listFilesRecursive(path.join(ROOT, folder)),
  );
  assert.ok(files.length > 0);
  const hits = files.flatMap((file) =>
    findForbidden(path.relative(ROOT, file), readRepositoryFile(ROOT, path.relative(ROOT, file))),
  );
  assert.deepEqual(
    hits.map(({ file, line, rule }) => `${file}:${String(line)} ${rule}`),
    [],
  );
});
