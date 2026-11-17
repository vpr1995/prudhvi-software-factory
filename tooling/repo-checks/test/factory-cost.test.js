// Tests for `metrics` of scripts/factory.mjs and the cost script (design factory-daily-run 4.6,
// R-32, R-33). `gh` is a stub with a stateful comment list. The transcripts are fixtures in a temp
// folder: the tests never read a real transcript. Every fixture message holds a fake secret in its
// text, and no output may carry it.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { main } from '../scripts/factory.mjs';
import { MARKER } from '../scripts/lib/factory-comment.mjs';
import { priceOf } from '../scripts/lib/factory-prices.mjs';
import { writeAtomic } from '../scripts/lib/fs-io.mjs';

const STATE = '.claude/factory';
const FAKE_SECRET = 'sk-FAKEFAKEFAKEFAKEFAKEFAKE0123';
const PASSWORD_TEXT = 'password=hunter2 and the plan is to ship on friday';
const MINUTE = 60_000;
const SECOND = 1000;
const T0 = Date.parse('2026-11-17T08:00:00Z');
const MILLION = 1_000_000;
const OPUS = 'claude-opus-5-5';
const SONNET = 'claude-sonnet-5-5';
const roots = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const temporaryFolder = () => {
  const root = mkdtempSync(path.join(tmpdir(), 'factory-cost-'));
  roots.push(root);
  return root;
};

const iso = (ms) => new Date(ms).toISOString();
const isoSeconds = (ms) => iso(ms).replace(/\.\d+Z$/, 'Z');
const stateFile = (root, ...parts) => path.join(root, STATE, ...parts);

// The repo root and the transcript root of one test. The project folder name is the repo path with
// each character that is not a letter or a digit replaced by "-".
function makeWork() {
  const folder = temporaryFolder();
  const work = path.join(folder, 'work');
  mkdirSync(work);
  const transcripts = path.join(folder, 'projects');
  const project = path.join(transcripts, work.replaceAll(/[^A-Za-z0-9]/g, '-'));
  mkdirSync(project, { recursive: true });
  return { work, transcripts, project };
}

const seedTicket = (root, extra = {}) =>
  writeAtomic(
    stateFile(root, '7', 'ticket.json'),
    JSON.stringify({
      issue: 7,
      stage: 'green',
      branch: 'feat/7-x',
      base: null,
      pr: 12,
      stackedOn: 5,
      restartedAt: null,
      resumes: 1,
      decisions: 2,
      routing: {
        overBudget: true,
        passes: [{ name: 'spec-reviewer' }, { name: 'fresh-reviewer' }],
      },
      ...extra,
    }),
  );

const logLine = (ms, to, extra = {}) =>
  JSON.stringify({
    ts: isoSeconds(ms),
    ticket: 7,
    event: 'stage',
    from: null,
    to,
    detail: '',
    ...extra,
  });

// Run log of the run r1: the ticket starts at T0 and ends at T0 + 30 minutes.
const STAGE_LINES = [
  logLine(T0, 'building'),
  logLine(T0 + 10 * MINUTE, 'reviewing'),
  logLine(T0 + 25 * MINUTE, 'ci'),
  logLine(T0 + 30 * MINUTE, 'green'),
];

function seedRun(root, { lines = STAGE_LINES, sessionIds = ['sess-a'] } = {}) {
  writeAtomic(
    stateFile(root, 'run.json'),
    JSON.stringify({ runId: 'r1', sessionId: sessionIds[0] ?? null, sessionIds, active: false }),
  );
  writeAtomic(stateFile(root, 'runs', 'r1.jsonl'), `${lines.join('\n')}\n`);
}

// Keys with "_" are written as strings in a list, because the lint naming rule has no exception for them.
const usage = (input, output, [write, read] = [0, 0]) =>
  Object.fromEntries([
    ['input_tokens', input],
    ['output_tokens', output],
    ['cache_creation_input_tokens', write],
    ['cache_read_input_tokens', read],
  ]);
const OUTPUT_TOKENS = 'output_tokens';

const assistant = (ms, id, [model, tokens]) =>
  JSON.stringify({
    type: 'assistant',
    timestamp: iso(ms),
    message: {
      id,
      model,
      role: 'assistant',
      content: [{ type: 'text', text: `${FAKE_SECRET} ${PASSWORD_TEXT}` }],
      usage: tokens,
    },
  });

const userLine = (ms) =>
  JSON.stringify({
    type: 'user',
    timestamp: iso(ms),
    message: { role: 'user', content: `${FAKE_SECRET} ${PASSWORD_TEXT}` },
  });

const writeTranscript = (project, name, lines) =>
  writeAtomic(path.join(project, name), `${lines.join('\n')}\n`);

// The main fixture. Cost in US dollars with the prices of lib/factory-prices.mjs (per million tokens):
//   m1 opus   in 1M, out 100k, write 200k, read 3M: 4 + 2 + 1 + 0.6 = 7.6 (the line is there twice)
//   m2 sonnet in 500k, out 50k, read 1M: 1 + 0.5 + 0.1 = 1.6
//   m3 sonnet in 1M: 2, at 500 ms after the last run log line: in the slice (the log has seconds)
//   s1 opus (a subagent) in 100k, out 10k: 0.4 + 0.2 = 0.6
// Outside the slice and not counted: m0 (before the first log line), m4 (1 s after the last second),
// and a session that is not in sessionIds.
function seedTranscripts({ project }) {
  writeTranscript(project, 'sess-a.jsonl', [
    userLine(T0 - MINUTE),
    assistant(T0 - MINUTE, 'm0', [OPUS, usage(9 * MILLION, 9 * MILLION)]),
    assistant(T0 + MINUTE, 'm1', [OPUS, usage(MILLION, 100_000, [200_000, 3 * MILLION])]),
    assistant(T0 + MINUTE + SECOND, 'm1', [OPUS, usage(MILLION, 100_000, [200_000, 3 * MILLION])]),
    userLine(T0 + 90 * SECOND),
    assistant(T0 + 2 * MINUTE, 'm2', [SONNET, usage(500_000, 50_000, [0, MILLION])]),
    assistant(T0 + 30 * MINUTE + 500, 'm3', [SONNET, usage(MILLION, 0)]),
    assistant(T0 + 30 * MINUTE + SECOND, 'm4', [OPUS, usage(9 * MILLION, 9 * MILLION)]),
  ]);
  mkdirSync(path.join(project, 'sess-a', 'subagents'), { recursive: true });
  writeTranscript(project, path.join('sess-a', 'subagents', 'agent-1.jsonl'), [
    assistant(T0 + 3 * MINUTE, 's1', [OPUS, usage(100_000, 10_000)]),
  ]);
  writeAtomic(path.join(project, 'sess-a', 'subagents', 'agent-1.meta.json'), '{"bad":');
  writeTranscript(project, 'sess-other.jsonl', [
    assistant(T0 + MINUTE, 'o1', [OPUS, usage(9 * MILLION, 9 * MILLION)]),
  ]);
}

/**
 * A gh stub. It keeps the comments of the issue and the PR, so a second call finds the first
 * comment. It records each call and the body file text at call time.
 */
function makeGh({ comments = [], runs = [] } = {}) {
  const calls = [];
  const store = [...comments];
  let nextId = 500;
  const bodyOf = (args) => {
    const at = args.indexOf('--body-file');
    if (at !== -1) return readFileSync(args[at + 1], 'utf8');
    const field = args.indexOf('--field');
    return field === -1 ? undefined : readFileSync(args[field + 1].replace(/^body=@/, ''), 'utf8');
  };
  const gh = (args) => {
    const body = bodyOf(args);
    calls.push({ args, body });
    const [first, second] = args;
    const list = /^repos\/\{owner\}\/\{repo\}\/issues\/(\d+)\/comments$/.exec(second ?? '');
    const edit = /^repos\/\{owner\}\/\{repo\}\/issues\/comments\/(\d+)$/.exec(second ?? '');
    if (first === 'api' && list !== null) {
      return JSON.stringify([store.filter((entry) => entry.target === list[1])]);
    }
    if (first === 'api' && edit !== null) {
      store.find((entry) => entry.id === Number(edit[1])).body = body;
      return '';
    }
    if ((first === 'issue' || first === 'pr') && second === 'comment') {
      store.push({ id: nextId, target: args[2], body });
      nextId += 1;
      return '';
    }
    if (first === 'run' && second === 'list') return JSON.stringify(runs);
    return '';
  };
  return { gh, calls, store };
}

const creates = (calls) => calls.filter(({ args }) => args[1] === 'comment' && args[0] !== 'api');
const patches = (calls) => calls.filter(({ args }) => args.includes('PATCH'));

function runMetrics(setup, overrides = {}, words = ['metrics', '7']) {
  const out = [];
  const errors = [];
  const { gh, calls, store } = overrides.ghParts ?? makeGh();
  const code = main(['node', 'factory.mjs', ...words], {
    root: setup.work,
    gh,
    now: () => new Date(T0 + 40 * MINUTE),
    stdin: () => '',
    claudeVersion: () => '2.1.300 (Claude Code)\n',
    transcriptRoot: () => setup.transcripts,
    ...overrides.context,
    print: (text) => out.push(text),
    err: (text) => errors.push(text),
  });
  return { code, out: out.join(''), errors: errors.join(''), calls, store };
}

const BLOCK = /```factory-metrics\n([^\n]*)\n```/;
const metricsOf = (body) => JSON.parse(BLOCK.exec(body)[1]);
const postedBody = (result) => result.calls.find(({ args }) => args[1] === 'comment').body;

function fullSetup() {
  const setup = makeWork();
  seedTicket(setup.work);
  seedRun(setup.work);
  seedTranscripts(setup);
  return setup;
}

// R-33: output

test('R-33: the output of metrics holds no transcript text and no fake secret', () => {
  const setup = fullSetup();
  const result = runMetrics(setup);
  assert.equal(result.code, 0, result.errors);
  const everything = [
    result.out,
    result.errors,
    ...result.calls.map(({ args, body }) => `${args.join(' ')}\n${body ?? ''}`),
  ].join('\n');
  for (const text of [FAKE_SECRET, 'hunter2', 'password', 'friday', 'plan is to ship']) {
    assert.ok(!everything.includes(text), `${text} must not be in any output`);
  }
  assert.ok(postedBody(result).startsWith(`${MARKER}\n`));
});

// R-33: cost and slice

test('R-33: the cost counts the main and the subagent transcript of the run sessions in the ticket slice', () => {
  const setup = fullSetup();
  const result = runMetrics(setup);
  assert.equal(result.code, 0, result.errors);
  const metrics = metricsOf(postedBody(result));
  // m1 counts once (a repeated message id), m0 and m4 are outside the slice, sess-other is not a run session.
  assert.equal(metrics.cost, 11.8);
  assert.equal(metrics.turns, 4);
  assert.equal(result.errors, '');
});

test('R-33: a message needs a time stamp between the first and the last run log line of the ticket', () => {
  const setup = makeWork();
  seedTicket(setup.work);
  // A line of another ticket is not part of the slice of ticket 7.
  seedRun(setup.work, {
    lines: [
      logLine(T0 - 2 * MINUTE, 'building', { ticket: 8 }),
      logLine(T0 + MINUTE, 'building'),
      logLine(T0 + 3 * MINUTE, 'green'),
      logLine(T0 + 20 * MINUTE, 'building', { ticket: 8 }),
    ],
  });
  writeTranscript(setup.project, 'sess-a.jsonl', [
    assistant(T0 + MINUTE - 1, 'before', [OPUS, usage(MILLION, 0)]),
    assistant(T0 + MINUTE, 'first', [OPUS, usage(MILLION, 0)]),
    assistant(T0 + 3 * MINUTE + 999, 'last', [OPUS, usage(MILLION, 0)]),
    assistant(T0 + 3 * MINUTE + 1000, 'after', [OPUS, usage(MILLION, 0)]),
  ]);
  const result = runMetrics(setup);
  assert.equal(result.code, 0, result.errors);
  const metrics = metricsOf(postedBody(result));
  assert.equal(metrics.turns, 2);
  assert.equal(metrics.cost, 8);
});

test('R-33: an unknown model gives cost null and a warning, and the turns stay', () => {
  const setup = fullSetup();
  writeTranscript(setup.project, 'sess-a.jsonl', [
    assistant(T0 + MINUTE, 'm1', [OPUS, usage(MILLION, 0)]),
    assistant(T0 + 2 * MINUTE, 'm2', ['claude-mystery-9', usage(MILLION, 0)]),
  ]);
  const result = runMetrics(setup);
  assert.equal(result.code, 0, result.errors);
  const metrics = metricsOf(postedBody(result));
  assert.equal(metrics.cost, null);
  assert.equal(metrics.turns, 3, 'the subagent message counts too');
  assert.match(result.errors, /warning: unknown model "claude-mystery-9"/);
});

test('R-33: a model name that is not a plain name is not echoed', () => {
  const setup = fullSetup();
  writeTranscript(setup.project, 'sess-a.jsonl', [
    assistant(T0 + MINUTE, 'm1', ['my model password=hunter2', usage(MILLION, 0)]),
  ]);
  const result = runMetrics(setup);
  assert.equal(result.code, 0, result.errors);
  assert.match(result.errors, /warning: unknown model "<invalid name>"/);
  assert.ok(!result.errors.includes('hunter2'));
});

test('R-33: a parse failure gives cost null and turns null, and a warning with the file and the line, no text', () => {
  const setup = fullSetup();
  writeTranscript(setup.project, 'sess-a.jsonl', [
    userLine(T0 + MINUTE),
    assistant(T0 + MINUTE, 'm1', [OPUS, usage(MILLION, 0)]),
    `{"type":"assistant","timestamp":"${iso(T0 + 2 * MINUTE)}","message":{"id":"m2","content":"${FAKE_SECRET} ${PASSWORD_TEXT}`,
  ]);
  const result = runMetrics(setup);
  assert.equal(result.code, 0, result.errors);
  const metrics = metricsOf(postedBody(result));
  assert.equal(metrics.cost, null);
  assert.equal(metrics.turns, null);
  assert.match(result.errors, /warning: .*sess-a\.jsonl line 3.*not valid JSON/);
  assert.ok(!result.errors.includes(FAKE_SECRET));
  assert.ok(!result.errors.includes('friday'));
});

test('R-33: a usage field that is not a number is a parse failure', () => {
  const setup = fullSetup();
  writeTranscript(setup.project, 'sess-a.jsonl', [
    assistant(T0 + MINUTE, 'm1', [OPUS, { ...usage(MILLION, 0), [OUTPUT_TOKENS]: '12' }]),
  ]);
  const result = runMetrics(setup);
  const metrics = metricsOf(postedBody(result));
  assert.equal(metrics.cost, null);
  assert.match(result.errors, /warning: .*sess-a\.jsonl line 1.*usage/);
});

test('R-33: a missing transcript, a bad session id and no session id give cost null and a warning', () => {
  const setup = fullSetup();
  seedRun(setup.work, { sessionIds: ['sess-a', 'sess-missing', '../sess-other'] });
  const missing = runMetrics(setup);
  assert.equal(metricsOf(postedBody(missing)).cost, null);
  assert.match(missing.errors, /warning: transcript of session sess-missing not found/);
  assert.match(missing.errors, /warning: session id #3 is not valid/);
  const none = fullSetup();
  seedRun(none.work, { sessionIds: [] });
  const empty = runMetrics(none);
  assert.equal(metricsOf(postedBody(empty)).cost, null);
  assert.match(empty.errors, /warning: run\.json has no session id/);
});

test('R-33: only the transcripts of the run sessions are opened', () => {
  const setup = fullSetup();
  // sess-other has a malformed line: reading it would give a warning and cost null.
  writeAtomic(path.join(setup.project, 'sess-other.jsonl'), `{"type":"assistant"\n`);
  const result = runMetrics(setup);
  assert.equal(result.errors, '');
  assert.equal(metricsOf(postedBody(result)).cost, 11.8);
});

test('R-33: a ticket with no run log line has no slice: cost null and a warning', () => {
  const setup = fullSetup();
  seedRun(setup.work, { lines: [logLine(T0, 'building', { ticket: 8 })] });
  const result = runMetrics(setup);
  assert.equal(result.code, 0, result.errors);
  const metrics = metricsOf(postedBody(result));
  assert.equal(metrics.cost, null);
  assert.equal(metrics.turns, null);
  assert.match(result.errors, /warning: no run log line for #7/);
});

// R-32

test('R-32: the comment is the marker line and one factory-metrics block with the version 2 fields', () => {
  const setup = fullSetup();
  writeAtomic(stateFile(setup.work, '7', 'pre-pr', 'round-1.json'), '{}\n');
  writeAtomic(stateFile(setup.work, '7', 'pre-pr', 'round-2.json'), '{}\n');
  writeAtomic(stateFile(setup.work, '7', 'pre-pr', 'findings.md'), '');
  const ghParts = makeGh({
    runs: [
      { conclusion: 'failure', createdAt: iso(T0) },
      { conclusion: 'success', createdAt: iso(T0) },
      { conclusion: 'cancelled', createdAt: iso(T0) },
      { conclusion: 'timed_out', createdAt: iso(T0) },
    ],
  });
  const result = runMetrics(setup, { ghParts });
  assert.equal(result.code, 0, result.errors);
  const { body, args } = creates(ghParts.calls)[0];
  assert.deepEqual(args.slice(0, 4), ['pr', 'comment', '12', '--body-file']);
  assert.ok(body.startsWith(`${MARKER}\n`));
  assert.match(body, /^[^\n]+\n```factory-metrics\n[^\n]+\n```\n?$/);
  assert.deepEqual(Object.entries(metricsOf(body)), [
    ['v', 2],
    ['issue', 7],
    ['pr', 12],
    ['cost', 11.8],
    ['turns', 4],
    ['review_rounds', 2],
    ['ci_rounds', 2],
    ['outcome', 'green'],
    ['stages', { building: 600, reviewing: 900, ci: 300, green: 0 }],
    ['reviewers', ['spec-reviewer', 'fresh-reviewer']],
    ['over_budget', true],
    ['decisions', 2],
    ['stacked_on', 5],
    ['resumes', 1],
    ['ci_runs', 4],
    ['claude_code', '2.1.300'],
  ]);
  assert.match(result.out, /#7: metrics comment created on PR #12/);
});

test('R-32: a second metrics call edits the comment in place with the version 2 fields', () => {
  const setup = fullSetup();
  const ghParts = makeGh();
  assert.equal(runMetrics(setup, { ghParts }).code, 0);
  seedTicket(setup.work, { decisions: 3 });
  const second = runMetrics(setup, { ghParts });
  assert.equal(second.code, 0, second.errors);
  assert.equal(creates(ghParts.calls).length, 1, 'no second comment');
  const [patch] = patches(ghParts.calls);
  assert.deepEqual(patch.args.slice(0, 4), [
    'api',
    'repos/{owner}/{repo}/issues/comments/500',
    '--method',
    'PATCH',
  ]);
  assert.equal(ghParts.store.length, 1);
  const metrics = metricsOf(ghParts.store[0].body);
  assert.equal(metrics.v, 2);
  assert.equal(metrics.decisions, 3);
  assert.ok(ghParts.store[0].body.startsWith(`${MARKER}\n`));
  assert.match(second.out, /#7: metrics comment edited on PR #12/);
  for (const argument of patch.args)
    assert.ok(!argument.includes('factory-metrics'), 'no body in argv');
});

test('R-32: a version 1 comment with no marker is found by its block and edited', () => {
  const setup = fullSetup();
  const v1 =
    '```factory-metrics\n{"issue":7,"pr":12,"cost":1,"turns":2,"review_rounds":1,"ci_rounds":0,"outcome":"green"}\n```';
  const ghParts = makeGh({
    comments: [
      { id: 70, target: '12', body: 'Looks good to me' },
      { id: 77, target: '12', body: v1 },
      { id: 80, target: '7', body: v1 },
    ],
  });
  const result = runMetrics(setup, { ghParts });
  assert.equal(result.code, 0, result.errors);
  assert.equal(creates(ghParts.calls).length, 0);
  assert.equal(patches(ghParts.calls).length, 1);
  assert.equal(patches(ghParts.calls)[0].args[1], 'repos/{owner}/{repo}/issues/comments/77');
  assert.equal(metricsOf(ghParts.store.find((entry) => entry.id === 77).body).v, 2);
  assert.equal(ghParts.store.find((entry) => entry.id === 80).body, v1, 'the issue comment stays');
});

test('R-32: with no PR the comment goes on the issue', () => {
  const setup = fullSetup();
  seedTicket(setup.work, { pr: null });
  const ghParts = makeGh();
  const result = runMetrics(setup, { ghParts });
  assert.equal(result.code, 0, result.errors);
  assert.deepEqual(creates(ghParts.calls)[0].args.slice(0, 4), [
    'issue',
    'comment',
    '7',
    '--body-file',
  ]);
  assert.equal(metricsOf(creates(ghParts.calls)[0].body).pr, null);
  assert.match(result.out, /on the issue/);
});

test('R-32: the outcome is needs-human for a stopped ticket, and green for green and done', () => {
  for (const [stage, outcome] of [
    ['needs-human', 'needs-human'],
    ['green', 'green'],
    ['done', 'green'],
  ]) {
    const setup = fullSetup();
    seedTicket(setup.work, { stage });
    const result = runMetrics(setup);
    assert.equal(metricsOf(postedBody(result)).outcome, outcome, stage);
  }
});

test('R-32: a ticket that has not ended or has no state is refused, and nothing is posted', () => {
  const setup = fullSetup();
  for (const stage of ['building', 'reviewing']) {
    seedTicket(setup.work, { stage });
    const ghParts = makeGh();
    const result = runMetrics(setup, { ghParts });
    assert.equal(result.code, 2, stage);
    assert.match(result.errors, /has not ended/);
    assert.equal(ghParts.calls.length, 0);
  }
  const bare = makeWork();
  const none = runMetrics(bare);
  assert.equal(none.code, 2);
  assert.match(none.errors, /no ticket state/);
  const usageResult = runMetrics(setup, {}, ['metrics']);
  assert.equal(usageResult.code, 2);
  assert.match(usageResult.errors, /ticket number must be a positive integer/);
});

test('R-32: a claude version that cannot be read gives claude_code null and a warning', () => {
  const setup = fullSetup();
  const result = runMetrics(setup, {
    context: {
      claudeVersion: () => {
        throw new Error('spawn claude ENOENT');
      },
    },
  });
  assert.equal(result.code, 0, result.errors);
  assert.equal(metricsOf(postedBody(result)).claude_code, null);
  assert.match(result.errors, /warning: claude version not readable/);
});

test('R-32: a ticket with no branch has ci_runs null and ci_rounds null, and a warning', () => {
  const setup = fullSetup();
  seedTicket(setup.work, { branch: null });
  const ghParts = makeGh();
  const result = runMetrics(setup, { ghParts });
  assert.equal(result.code, 0, result.errors);
  const metrics = metricsOf(postedBody(result));
  assert.equal(metrics.ci_runs, null);
  assert.equal(metrics.ci_rounds, null);
  assert.match(result.errors, /warning: ticket has no branch/);
  assert.ok(ghParts.calls.every(({ args }) => args[1] !== 'list' || args[0] !== 'run'));
});

// Prices

test('R-33: the price table has the known models, and an unknown name has no price', () => {
  assert.deepEqual(priceOf(OPUS), { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 });
  assert.deepEqual(priceOf(SONNET), { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 });
  assert.equal(priceOf(`${OPUS}[1m]`)?.input, 4, 'a context suffix is not part of the model');
  assert.equal(priceOf(`${OPUS}-20261101`)?.input, 4, 'a date suffix is not part of the model');
  assert.equal(priceOf('claude-mystery-9'), undefined);
});
