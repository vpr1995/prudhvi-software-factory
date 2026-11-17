// Tests for the factory Stop hook and `wait` (design factory-daily-run 4.1, 4.3, 4.7: R-44, R-45,
// R-48, R-49, R-56). The hook has no network call: `gh` of a hook test throws. `wait` gets a stub
// `gh`, a fake clock and a fake sleep, so no test sleeps for real.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { main } from '../scripts/factory.mjs';
import { handleStopCheck } from '../scripts/lib/factory-stop-check.mjs';
import { exists, listFolder, readOptional, writeAtomic } from '../scripts/lib/fs-io.mjs';

import { pathFromEnv } from './test-env.config.js';

const SCRIPTS = path.resolve(import.meta.dirname, '../scripts');
const STATE = '.claude/factory';
const RUN_ID = '20261117T100000Z';
const NOW = new Date('2026-11-17T10:00:00Z');
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const STEP = { kind: 'ticket', ticket: 5, resume: false };
const roots = [];
const SESSION_KEY = 'session_id';
const hookInput = (session) => JSON.stringify({ [SESSION_KEY]: session });
const ignore = () => 0;

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const temporaryRoot = () => {
  const root = mkdtempSync(path.join(tmpdir(), 'factory-stop-'));
  roots.push(root);
  return root;
};

const stateFile = (root, name) => path.join(root, STATE, name);
const readJson = (root, name) => JSON.parse(readFileSync(stateFile(root, name), 'utf8'));
const runLogFile = (root) => stateFile(root, `runs/${RUN_ID}.jsonl`);

const OPEN_RUN = {
  runId: RUN_ID,
  sessionId: null,
  sessionIds: [],
  active: true,
  stalled: false,
  startedAt: '2026-11-17T10:00:00Z',
  only: null,
  next: STEP,
  waiting: null,
  stopChecks: { count: 0, lastHash: null },
};

function setup(run = {}) {
  const root = temporaryRoot();
  writeAtomic(stateFile(root, 'run.json'), `${JSON.stringify({ ...OPEN_RUN, ...run })}\n`);
  return root;
}

const logLine = (event, detail = 'x', ticket = 0) =>
  `${JSON.stringify({ ts: '2026-11-17T10:00:00Z', ticket, event, from: null, to: null, detail })}\n`;

/** Runs the check of one session in process. `gh` throws: the hook must not call it. */
function check(root, session, extra = {}) {
  const errors = [];
  const context = {
    root,
    now: () => NOW,
    pid: process.pid,
    runOff: () => false,
    err: (text) => errors.push(text),
    gh: () => assert.fail('the Stop hook must not call gh'),
    ...extra,
  };
  const input = hookInput(session);
  const output = handleStopCheck(input, context);
  return { output: output === undefined ? undefined : JSON.parse(output), errors };
}

const blocked = (result) => result.output?.decision === 'block';

// R-44

test('R-44: the owning session is blocked with the stored next step', () => {
  const root = setup({ sessionId: 's1', sessionIds: ['s1'] });
  const result = check(root, 's1');
  assert.equal(result.output.decision, 'block');
  assert.match(result.output.reason, /start #5/);
});

test('R-44: the first check claims the run with the session id of the hook input', () => {
  const root = setup();
  assert.ok(blocked(check(root, 's1')));
  const run = readJson(root, 'run.json');
  assert.equal(run.sessionId, 's1');
  assert.deepEqual(run.sessionIds, ['s1']);
  assert.ok(blocked(check(root, 's2')) === false, 'a second session does not take the run');
  assert.equal(readJson(root, 'run.json').sessionId, 's1');
});

test('R-44: another session is allowed and the run stays as it is', () => {
  const root = setup({ sessionId: 's1', sessionIds: ['s1'] });
  const before = readOptional(stateFile(root, 'run.json'));
  assert.equal(check(root, 'other').output, undefined);
  assert.equal(readOptional(stateFile(root, 'run.json')), before);
});

test('R-44: next = done is allowed', () => {
  const root = setup({ sessionId: 's1', next: { kind: 'done' } });
  assert.equal(check(root, 's1').output, undefined);
});

test('R-44: no next result yet: the reason tells the agent to run next', () => {
  const root = setup({ sessionId: 's1', next: null });
  assert.match(check(root, 's1').output.reason, /factory\.mjs next/);
});

test('R-44: no run.json allows and writes nothing', () => {
  const root = temporaryRoot();
  assert.equal(check(root, 's1').output, undefined);
  assert.equal(exists(path.join(root, '.claude')), false);
});

test('R-44: a run that is not active allows', () => {
  const root = setup({ active: false, sessionId: 's1' });
  assert.equal(check(root, 's1').output, undefined);
});

test('R-44: a hook input with no session id is an error', () => {
  const root = setup();
  assert.throws(
    () => handleStopCheck('{}', { root, now: () => NOW, runOff: () => false }),
    /session/,
  );
  assert.throws(() => handleStopCheck('not json', { root, now: () => NOW, runOff: () => false }));
});

// R-45

test('R-45: FACTORY_RUN=off allows and clears the active run', () => {
  const root = setup({ sessionId: 's1' });
  assert.equal(check(root, 's1', { runOff: () => true }).output, undefined);
  const run = readJson(root, 'run.json');
  assert.equal(run.active, false);
  assert.equal(run.stalled, false);
  assert.equal(check(root, 's1').output, undefined, 'the run stays cleared');
});

test('R-45: after `stop` the hook allows', () => {
  const root = setup({ sessionId: 's1' });
  assert.ok(blocked(check(root, 's1')));
  const code = main(['node', 'factory.mjs', 'stop'], {
    root,
    now: () => NOW,
    print: ignore,
    err: ignore,
  });
  assert.equal(code, 0);
  assert.equal(check(root, 's1').output, undefined);
});

// R-48

function stallRun() {
  const root = setup({ sessionId: 's1', sessionIds: ['s1'] });
  writeAtomic(runLogFile(root), logLine('stage', 'building', 5));
  for (let index = 0; index < 3; index += 1) assert.ok(blocked(check(root, 's1')));
  return root;
}

test('R-48: 3 blocks with no change mark the run stalled and the 4th stop is allowed', () => {
  const root = stallRun();
  assert.equal(check(root, 's1').output, undefined);
  const run = readJson(root, 'run.json');
  assert.equal(run.stalled, true);
  assert.equal(run.active, false);
});

test('R-48: the run report says "stalled: run `/factory` to resume"', () => {
  const root = stallRun();
  check(root, 's1');
  const report = readFileSync(stateFile(root, `runs/${RUN_ID}-report.md`), 'utf8');
  assert.match(report, /stalled: run `\/factory` to resume/);
});

test('R-48: a stalled run allows each stop and stays stalled', () => {
  const root = stallRun();
  check(root, 's1');
  const before = readOptional(stateFile(root, 'run.json'));
  for (let index = 0; index < 3; index += 1) assert.equal(check(root, 's1').output, undefined);
  assert.equal(readOptional(stateFile(root, 'run.json')), before);
});

test('R-48: a change of the last run log line resets the count', () => {
  const root = setup({ sessionId: 's1' });
  writeAtomic(runLogFile(root), logLine('stage', 'building', 5));
  assert.ok(blocked(check(root, 's1')));
  assert.ok(blocked(check(root, 's1')));
  writeAtomic(runLogFile(root), logLine('stage', 'building', 5) + logLine('note', 'progress', 5));
  for (let index = 0; index < 3; index += 1) assert.ok(blocked(check(root, 's1')));
  assert.equal(readJson(root, 'run.json').stalled, false);
});

test('R-48: a change of the stored next result resets the count', () => {
  const root = setup({ sessionId: 's1' });
  for (let index = 0; index < 2; index += 1) assert.ok(blocked(check(root, 's1')));
  const run = readJson(root, 'run.json');
  writeAtomic(
    stateFile(root, 'run.json'),
    JSON.stringify({ ...run, next: { kind: 'ticket', ticket: 6, resume: false } }),
  );
  for (let index = 0; index < 3; index += 1) assert.ok(blocked(check(root, 's1')));
  assert.equal(readJson(root, 'run.json').stalled, false);
});

// R-49

test('R-49: a CI wait is allowed and the stop counts do not move', () => {
  const root = setup({ sessionId: 's1', waiting: { pr: 7, since: '2026-11-17T10:00:00Z' } });
  for (let index = 0; index < 6; index += 1) assert.equal(check(root, 's1').output, undefined);
  const run = readJson(root, 'run.json');
  assert.deepEqual(run.stopChecks, { count: 0, lastHash: null });
  assert.equal(run.stalled, false);
});

/** A gh stub for `wait`: `answers` is a function of the poll number. A test reads run.json inside. */
function waitWorld(root, answers) {
  const world = { polls: 0, sleeps: [], clock: NOW.getTime(), seen: [] };
  world.overrides = {
    root,
    now: () => new Date(world.clock),
    sleep: (ms) => {
      world.sleeps.push(ms);
      world.clock += ms;
    },
    gh: (args) => {
      assert.deepEqual(args.slice(0, 3), ['pr', 'checks', '7']);
      world.polls += 1;
      world.seen.push(readJson(root, 'run.json').waiting, check(root, 's1').output);
      return JSON.stringify(answers(world.polls));
    },
    print: (text) => (world.printed = (world.printed ?? '') + text),
    err: (text) => (world.errText = (world.errText ?? '') + text),
  };
  return world;
}

const PENDING = [{ name: 'ci', state: 'PENDING', bucket: 'pending' }];
const PASS = [{ name: 'ci', state: 'SUCCESS', bucket: 'pass' }];
const FAIL = [{ name: 'ci', state: 'FAILURE', bucket: 'fail' }];
const runWait = (world, words = ['7']) =>
  main(['node', 'factory.mjs', 'wait', ...words], world.overrides);

test('R-49: wait marks the wait, polls every 30 s, and clears the wait when CI ends', () => {
  const root = setup({ sessionId: 's1', next: { kind: 'wait', pr: 7 } });
  writeAtomic(runLogFile(root), logLine('stage', 'ci', 5));
  writeAtomic(stateFile(root, '5/ticket.json'), JSON.stringify({ stage: 'ci', pr: 7 }));
  const world = waitWorld(root, (poll) => (poll < 3 ? PENDING : PASS));
  assert.equal(runWait(world), 0);
  assert.equal(world.polls, 3);
  assert.deepEqual(world.sleeps, [30 * SECOND, 30 * SECOND]);
  assert.deepEqual(world.seen[0], { pr: 7, since: '2026-11-17T10:00:00Z' });
  assert.equal(world.seen[1], undefined, 'the Stop hook allows during the wait');
  assert.match(world.printed, /passed/);
  assert.equal(readJson(root, 'run.json').waiting, null);
  const events = readFileSync(runLogFile(root), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
    .filter((line) => line.event === 'wait');
  assert.deepEqual(
    events.map((line) => line.detail),
    ['start', 'end'],
  );
  assert.equal(events[0].ticket, 5, 'the wait line belongs to the current ticket');
});

test('R-49: wait reports a CI that ended with a failure', () => {
  const root = setup({ sessionId: 's1' });
  const world = waitWorld(root, () => FAIL);
  assert.equal(runWait(world), 0);
  assert.equal(world.polls, 1);
  assert.match(world.printed, /failed/);
  assert.equal(readJson(root, 'run.json').waiting, null);
});

test('R-49: wait on a CI that never ends exits "timeout" after 60 minutes', () => {
  const root = setup({ sessionId: 's1' });
  const world = waitWorld(root, () => PENDING);
  assert.equal(runWait(world), 3);
  assert.match(world.printed, /timeout/);
  assert.match(world.errText, /hard stop: CI timeout/);
  assert.equal(world.clock - NOW.getTime(), 60 * MINUTE);
  assert.equal(world.polls, 121);
  assert.equal(readJson(root, 'run.json').waiting, null);
});

test('R-49: wait with no checks yet keeps polling', () => {
  const root = setup({ sessionId: 's1' });
  const world = waitWorld(root, (poll) => (poll < 2 ? [] : PASS));
  assert.equal(runWait(world), 0);
  assert.equal(world.polls, 2);
});

test('R-49: wait needs an active run and a PR number', () => {
  const root = setup({ active: false });
  const world = waitWorld(root, () => PASS);
  assert.equal(runWait(world), 2);
  assert.match(world.errText, /no active run/);
  const active = setup();
  assert.equal(
    runWait(
      waitWorld(active, () => PASS),
      ['x'],
    ),
    2,
  );
  assert.equal(
    runWait(
      waitWorld(active, () => PASS),
      [],
    ),
    2,
  );
});

// Process level: the entry script, in a copy of the scripts folder in a temporary repo root.

const ENTRY = 'tooling/repo-checks/scripts/factory-stop-check.mjs';

function setupProcess(run = OPEN_RUN) {
  const root = temporaryRoot();
  cpSync(SCRIPTS, path.join(root, 'tooling/repo-checks/scripts'), { recursive: true });
  if (run !== null) {
    writeAtomic(stateFile(root, 'run.json'), `${JSON.stringify(run)}\n`);
  }
  return root;
}

function hook(root, session = 's1', environment = {}) {
  const started = performance.now();
  const result = spawnSync('node', [path.join(root, ENTRY)], {
    input: hookInput(session),
    encoding: 'utf8',
    env: { PATH: pathFromEnv(), ...environment },
  });
  return { ...result, ms: performance.now() - started };
}

test('R-44: with no run.json the hook allows at once, with no output and under 100 ms', () => {
  const root = setupProcess(null);
  const times = [hook(root), hook(root), hook(root)];
  for (const result of times) {
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  }
  assert.ok(Math.min(...times.map((result) => result.ms)) < 100, `took ${times[0].ms} ms`);
});

test('R-44: the hook entry blocks the owning session with JSON on stdout and exits 0', () => {
  const root = setupProcess();
  const result = hook(root);
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).decision, 'block');
  assert.equal(hook(root, 'other').stdout, '');
});

test('R-45: the hook entry with FACTORY_RUN=off allows and clears the run', () => {
  const root = setupProcess({ ...OPEN_RUN, sessionId: 's1' });
  const result = hook(root, 's1', { FACTORY_RUN: 'off' });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(readJson(root, 'run.json').active, false);
});

const breakCore = (root) =>
  writeFileSync(
    path.join(root, 'tooling/repo-checks/scripts/lib/factory-stop-check.mjs'),
    'export const = ;\n',
  );

test('R-56: a load error blocks twice, then the 3rd failure allows and prints the error', () => {
  const root = setupProcess();
  breakCore(root);
  for (const attempt of [1, 2]) {
    const result = hook(root);
    assert.equal(result.status, 0);
    assert.equal(JSON.parse(result.stdout).decision, 'block', `attempt ${String(attempt)}`);
    assert.match(JSON.parse(result.stdout).reason, /SyntaxError|Unexpected/);
  }
  const third = hook(root);
  assert.equal(third.status, 0);
  assert.equal(third.stdout, '');
  assert.match(third.stderr, /SyntaxError|Unexpected/);
  assert.equal(readOptional(stateFile(root, 'stop-errors')).trim(), '3');
  assert.equal(hook(root).stdout, '', 'the stop stays allowed');
});

test('R-56: a good check resets the error count', () => {
  const root = setupProcess();
  breakCore(root);
  hook(root);
  assert.equal(readOptional(stateFile(root, 'stop-errors')).trim(), '1');
  cpSync(
    path.join(SCRIPTS, 'lib/factory-stop-check.mjs'),
    path.join(root, 'tooling/repo-checks/scripts/lib/factory-stop-check.mjs'),
  );
  assert.equal(JSON.parse(hook(root).stdout).decision, 'block');
  assert.equal(exists(stateFile(root, 'stop-errors')), false);
});

test('R-56: with no open run a broken core does not matter and no count file is made', () => {
  const root = setupProcess({ ...OPEN_RUN, active: false });
  breakCore(root);
  const result = hook(root);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  assert.deepEqual(
    listFolder(stateFile(root, '.')).filter((name) => name === 'stop-errors'),
    [],
  );
});

test('R-56: a bad hook input is an error, not a crash', () => {
  const root = setupProcess();
  const result = spawnSync('node', [path.join(root, ENTRY)], {
    input: 'not json',
    encoding: 'utf8',
    env: { PATH: pathFromEnv() },
  });
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).decision, 'block');
});
