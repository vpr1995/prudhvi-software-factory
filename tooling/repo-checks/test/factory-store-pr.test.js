// Tests for the PR number in ticket.json (issue 134). `stage <n> ci` stores it. `metrics <n>` uses it,
// or looks it up. The run report lists it. `gh` is a stub. No test calls the real gh or the network.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { main } from '../scripts/factory.mjs';
import { writeAtomic } from '../scripts/lib/fs-io.mjs';

const STATE = '.claude/factory';
const REPOSITORY = 'vpr1995/projects-monorepo';
const BRANCH = 'feat/7-x';
const LOGIN = 'factory-bot';
const FENCE = '`'.repeat(3);
const BOARD = {
  fields: [
    {
      id: 'F_STATUS',
      name: 'Status',
      options: [
        { id: 'o-progress', name: 'In progress' },
        { id: 'o-review', name: 'In review' },
      ],
    },
  ],
};
const ITEMS = { items: [{ id: 'I_7', content: { number: 7, repository: REPOSITORY } }] };
const roots = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const temporaryFolder = () => {
  const root = mkdtempSync(path.join(tmpdir(), 'factory-store-pr-'));
  roots.push(root);
  return root;
};

const stateFile = (root, ...parts) => path.join(root, STATE, ...parts);
const readTicket = (root) => JSON.parse(readFileSync(stateFile(root, '7', 'ticket.json'), 'utf8'));

function seedTicket(root, extra = {}) {
  writeAtomic(
    stateFile(root, '7', 'ticket.json'),
    JSON.stringify({
      issue: 7,
      stage: 'reviewing',
      branch: BRANCH,
      base: null,
      pr: null,
      stackedOn: null,
      restartedAt: null,
      resumes: 0,
      decisions: 0,
      routing: {},
      ...extra,
    }),
  );
}

const BOARD_REPLIES = new Map([
  ['project field-list', JSON.stringify(BOARD)],
  ['project item-list', JSON.stringify(ITEMS)],
  ['project view', JSON.stringify({ id: 'PVT_2' })],
  ['repo view', `${REPOSITORY}\n`],
  ['api user', `${LOGIN}\n`],
]);
const COMMENT_LIST = /issues\/(\d+)\/comments$/;

/**
 * A gh stub. `prList` is the reply of `gh pr list`: a list of PRs, or an Error to throw. It records
 * each call. A comment create is recorded in `posted` with the place (`pr` or `issue`) and the number.
 */
function makeGh({ prList = [], comments = [] } = {}) {
  const calls = [];
  const posted = [];
  const gh = (args) => {
    calls.push(args);
    const [first, second] = args;
    const key = args.slice(0, 2).join(' ');
    if (key === 'pr list') {
      if (prList instanceof Error) throw prList;
      return JSON.stringify(prList);
    }
    if (first === 'api' && COMMENT_LIST.test(second)) {
      return JSON.stringify([
        comments.filter((entry) => entry.place === COMMENT_LIST.exec(second)[1]),
      ]);
    }
    if (second === 'comment') {
      posted.push({ place: first, number: args[2], body: readFileSync(args[4], 'utf8') });
    }
    return BOARD_REPLIES.get(key) ?? '';
  };
  return { gh, calls, posted };
}

function run(root, words, gh) {
  const out = [];
  const errors = [];
  const code = main(['node', 'factory.mjs', ...words], {
    root,
    gh,
    git: () => `${BRANCH}\n`,
    now: () => new Date('2026-11-17T10:00:00Z'),
    stdin: () => '',
    claudeVersion: () => '2.1.300 (Claude Code)\n',
    transcriptRoot: () => path.join(root, 'no-transcripts'),
    sessionId: () => '',
    print: (text) => out.push(text),
    err: (text) => errors.push(text),
  });
  return { code, out: out.join(''), errors: errors.join('') };
}

const METRICS_LINE = /```factory-metrics\n([^\n]*)\n/;
const metricsOf = (body) => JSON.parse(METRICS_LINE.exec(body)[1]);
const prListCalls = (calls) =>
  calls.filter(([first, second]) => first === 'pr' && second === 'list');

// Acceptance 1: stage ci

test('#134: stage ci stores the number of the open PR of the ticket branch as pr', () => {
  const root = temporaryFolder();
  seedTicket(root);
  const { gh, calls } = makeGh({ prList: [{ number: 133 }] });
  const result = run(root, ['stage', '7', 'ci'], gh);
  assert.equal(result.code, 0, result.errors);
  assert.equal(readTicket(root).pr, 133);
  assert.equal(readTicket(root).stage, 'ci');
  assert.deepEqual(prListCalls(calls), [
    ['pr', 'list', '--head', BRANCH, '--state', 'open', '--json', 'number'],
  ]);
  assert.equal(result.errors, '');
});

test('#134: stage ci with no open PR still moves, keeps the old pr and warns on stderr', () => {
  const root = temporaryFolder();
  seedTicket(root, { pr: 99 });
  const result = run(root, ['stage', '7', 'ci'], makeGh({ prList: [] }).gh);
  assert.equal(result.code, 0, result.errors);
  assert.equal(readTicket(root).stage, 'ci');
  assert.equal(readTicket(root).pr, 99);
  assert.match(result.errors, /^warning: #7 .*no open PR/m);
});

test('#134: stage ci still moves and warns when gh pr list fails', () => {
  const root = temporaryFolder();
  seedTicket(root);
  const result = run(root, ['stage', '7', 'ci'], makeGh({ prList: new Error('boom') }).gh);
  assert.equal(result.code, 0, result.errors);
  assert.equal(readTicket(root).stage, 'ci');
  assert.equal(readTicket(root).pr, null);
  assert.match(result.errors, /^warning: #7 /m);
});

test('#134: a move to a stage other than ci makes no PR lookup', () => {
  const root = temporaryFolder();
  seedTicket(root, { stage: 'ci', pr: 133 });
  const { gh, calls } = makeGh({ prList: [{ number: 5 }] });
  const result = run(root, ['stage', '7', 'green'], gh);
  assert.equal(result.code, 0, result.errors);
  assert.deepEqual(prListCalls(calls), []);
  assert.equal(readTicket(root).pr, 133);
});

// Acceptance 2 and 3: metrics

test('#134: metrics with pr stored posts on that PR and the JSON has that pr, with no PR lookup', () => {
  const root = temporaryFolder();
  seedTicket(root, { stage: 'green', pr: 133 });
  const { gh, calls, posted } = makeGh({ prList: [{ number: 5 }] });
  const result = run(root, ['metrics', '7'], gh);
  assert.equal(result.code, 0, result.errors);
  assert.equal(posted.length, 1);
  assert.equal(posted[0].place, 'pr');
  assert.equal(posted[0].number, '133');
  assert.equal(metricsOf(posted[0].body).pr, 133);
  assert.match(result.out, /on PR #133/);
  assert.deepEqual(prListCalls(calls), []);
});

test('#134: metrics with pr stored edits the metrics comment of that PR', () => {
  const root = temporaryFolder();
  seedTicket(root, { stage: 'green', pr: 133 });
  const old = {
    id: 900,
    place: '133',
    user: { login: LOGIN },
    body: `<!-- factory-agent -->\n${FENCE}factory-metrics\n{"v":2}\n${FENCE}\n`,
  };
  const { gh, calls, posted } = makeGh({ comments: [old] });
  const result = run(root, ['metrics', '7'], gh);
  assert.equal(result.code, 0, result.errors);
  assert.deepEqual(posted, []);
  assert.ok(calls.some((args) => args.includes('repos/{owner}/{repo}/issues/comments/900')));
  assert.match(result.out, /edited on PR #133/);
});

test('#134: metrics with no pr stored and an open PR on the branch uses that PR', () => {
  const root = temporaryFolder();
  seedTicket(root, { stage: 'green', pr: null });
  const { gh, posted } = makeGh({ prList: [{ number: 133 }] });
  const result = run(root, ['metrics', '7'], gh);
  assert.equal(result.code, 0, result.errors);
  assert.equal(posted.length, 1);
  assert.equal(posted[0].place, 'pr');
  assert.equal(posted[0].number, '133');
  assert.equal(metricsOf(posted[0].body).pr, 133);
});

test('#134: metrics with no pr stored and no open PR posts on the issue with pr null', () => {
  const root = temporaryFolder();
  seedTicket(root, { stage: 'green', pr: null });
  const { gh, posted } = makeGh({ prList: [] });
  const result = run(root, ['metrics', '7'], gh);
  assert.equal(result.code, 0, result.errors);
  assert.equal(posted[0].place, 'issue');
  assert.equal(posted[0].number, '7');
  assert.equal(metricsOf(posted[0].body).pr, null);
});

test('#134: metrics with no pr stored and a failed PR lookup warns and posts on the issue', () => {
  const root = temporaryFolder();
  seedTicket(root, { stage: 'green', pr: null });
  const { gh, posted } = makeGh({ prList: new Error('boom') });
  const result = run(root, ['metrics', '7'], gh);
  assert.equal(result.code, 0, result.errors);
  assert.equal(posted[0].place, 'issue');
  assert.equal(metricsOf(posted[0].body).pr, null);
  assert.match(result.errors, /^warning: .*PR/m);
});

// Acceptance 4: run report

test('#134: the run report lists a green ticket with its PR number', () => {
  const root = temporaryFolder();
  seedTicket(root, { stage: 'green', pr: 133 });
  writeAtomic(
    stateFile(root, 'runs', 'old-run.jsonl'),
    `${JSON.stringify({ ts: '2026-11-17T09:00:00Z', ticket: 7, event: 'stage', from: null, to: 'green', detail: '' })}\n`,
  );
  writeAtomic(
    stateFile(root, 'run.json'),
    JSON.stringify({ runId: 'old-run', sessionIds: [], active: false, only: null }),
  );
  const result = run(root, ['report'], makeGh().gh);
  assert.equal(result.code, 0, result.errors);
  assert.match(result.out, /- #7, PR #133/);
  assert.match(result.out, /PRs that wait for a merge\n+- PR #133 \(#7\)/);
});
