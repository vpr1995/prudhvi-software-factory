// Tests for the review loop of scripts/factory.mjs (design factory-daily-run 4.5, task 6: R-9, R-30,
// R-31). `next` finds a new owner comment on the open PR of a green ticket before it starts a new
// ticket. `comments <n>` prints the comments that pass the owner filter. `comment <n> reply <id>`
// posts the reply, stores the comment id, and counts the reply for its thread. `gh` is a stub over a
// small world. No test calls the real gh or the network.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { main } from '../scripts/factory.mjs';
import { MARKER, ownerComments, readPrComments } from '../scripts/lib/factory-github.mjs';
import { readRepositoryFile, writeAtomic } from '../scripts/lib/fs-io.mjs';

const STATE = '.claude/factory';
const OWNER = 'vpr1995';
const REPO = 'vpr1995/projects-monorepo';
const NOW = new Date('2026-11-17T10:00:00Z');
const PR = 70;
const SKILL = '.claude/skills/factory/SKILL.md';
const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
// GitHub names these fields in snake case. A computed key keeps the naming rule quiet.
const IN_REPLY = 'in_reply_to_id';
const SUMMARY = 'sub_issues_summary';
const CREATED = 'created_at';
const FENCE = '`'.repeat(3);
const roots = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const temporaryFolder = () => {
  const root = mkdtempSync(path.join(tmpdir(), 'factory-comments-'));
  roots.push(root);
  return root;
};

const stateFile = (root, ...parts) => path.join(root, STATE, ...parts);
const readJson = (root, ...parts) => JSON.parse(readFileSync(stateFile(root, ...parts), 'utf8'));

// Comments as the GitHub API returns them.
const reviewComment = (id, login, body) => ({ id, user: { login }, body });
const review = ({ id, login = OWNER, body, state = 'COMMENTED' }) => ({
  id,
  user: { login },
  body,
  state,
});
const issueComment = (id, login, body) => ({ id, user: { login }, body });
const ownerReviewComment = (id, body = 'rename x', extra = {}) => ({
  ...reviewComment(id, OWNER, body),
  ...extra,
});
const metricsV1 = `Run metrics\n${FENCE}factory-metrics\n{"version":1}\n${FENCE}\n`;

const ticketBody =
  '### Context\n\nPaths: `docs/guides/x.md`\n\n### Acceptance\n\n- [ ] R-1: a thing\n\n### Notes\n\nSize: 2\n';

/** A gh stub over a world. Records each call with the text of its body file. */
function makeWorld(config = {}) {
  const world = {
    owner: OWNER,
    reviewComments: [],
    reviews: [],
    issueComments: [],
    readyTickets: [],
    prOfBranch: new Map([['feat/7-x', PR]]),
    checkBucket: 'pass',
    ...config,
  };
  const calls = [];
  const bodyOf = (args) => {
    const file = args.indexOf('--body-file');
    if (file !== -1) return readFileSync(args[file + 1], 'utf8');
    const field = args.find((argument) => argument.startsWith('body=@'));
    return field === undefined ? undefined : readFileSync(field.slice('body=@'.length), 'utf8');
  };
  const answerApi = ([, endpoint]) => {
    if (/\/pulls\/\d+\/comments$/.test(endpoint)) return JSON.stringify([world.reviewComments]);
    if (/\/pulls\/\d+\/reviews$/.test(endpoint)) return JSON.stringify([world.reviews]);
    if (/\/issues\/\d+\/comments$/.test(endpoint)) return JSON.stringify([world.issueComments]);
    if (endpoint.endsWith('/events')) {
      const event = {
        event: 'labeled',
        label: { name: 'agent:ready' },
        actor: { login: OWNER },
        [CREATED]: '2026-11-10T08:00:00Z',
      };
      return JSON.stringify([[event]]);
    }
    if (endpoint.endsWith('/dependencies/blocked_by')) return '[]';
    return JSON.stringify({ [SUMMARY]: { total: 0 } });
  };
  const answerIssue = (args) => {
    if (args[1] === 'list') {
      const label = args[args.indexOf('--label') + 1];
      const numbers = label === 'agent:ready' ? world.readyTickets : [7];
      return JSON.stringify(numbers.map((number) => ({ number })));
    }
    const number = Number(args[2]);
    const ready = world.readyTickets.includes(number);
    return JSON.stringify({
      state: 'OPEN',
      title: `ticket ${String(number)}`,
      body: ticketBody,
      labels: [{ name: ready ? 'agent:ready' : 'agent:in-progress' }],
      author: { login: OWNER },
    });
  };
  const answer = (args) => {
    const [first, second] = args;
    if (first === 'repo') {
      return JSON.stringify({ nameWithOwner: REPO, owner: { login: world.owner } });
    }
    if (first === 'project') {
      const items = [7, ...world.readyTickets].map((number) => ({
        id: `I_${String(number)}`,
        content: { number, type: 'Issue', repository: REPO },
        status: 'Ready',
      }));
      return JSON.stringify({ items });
    }
    if (first === 'issue') return answerIssue(args);
    if (first === 'run') return '[]';
    if (first === 'pr' && second === 'list') {
      const pr = world.prOfBranch.get(args[3]);
      return JSON.stringify(pr === undefined ? [] : [{ number: pr, state: 'OPEN' }]);
    }
    if (first === 'pr' && second === 'checks') {
      return JSON.stringify([{ name: 'ci', state: 'x', bucket: world.checkBucket }]);
    }
    if (first === 'api') return answerApi(args);
    return '';
  };
  const gh = (args) => {
    calls.push({ args, body: bodyOf(args) });
    return answer(args);
  };
  return { world, gh, calls };
}

const isWrite = ({ args }) =>
  args.includes('--method') ||
  (args[0] === 'pr' && args[1] === 'comment') ||
  (args[0] === 'issue' && args[1] === 'comment');

/** Runs one factory command in process. */
function factory(command, words, { gh, root, ...overrides }) {
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

const seedTicket = (root, ticket, extra = {}) =>
  writeAtomic(
    stateFile(root, String(ticket), 'ticket.json'),
    JSON.stringify({
      issue: ticket,
      stage: 'green',
      branch: `feat/${String(ticket)}-x`,
      base: null,
      pr: null,
      restartedAt: null,
      threadReplies: {},
      handledComments: [],
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
      next: null,
      waiting: null,
      stopChecks: { count: 0, lastHash: null },
      ...extra,
    }),
  );

/** A green ticket 7 with an open PR, an active run, and the world. `setup` edits the world. */
function scene({ ticket = {}, run = {}, ...config } = {}) {
  const root = temporaryFolder();
  const built = makeWorld(config);
  seedTicket(root, 7, ticket);
  seedRun(root, run);
  return { root, ...built };
}

const NEXT_COMMENT = /next: fix owner comments of #7 \(PR #70\)/;

// R-9

test('R-9: a comment with the agent marker, a metrics block, or a non-owner author is not returned', () => {
  const comments = readPrComments(
    makeWorld({
      reviewComments: [
        ownerReviewComment(1, `${MARKER}\nagent text`),
        reviewComment(2, 'someone-else', 'please add a test'),
        ownerReviewComment(3, 'keep this'),
      ],
      reviews: [
        review({ id: 4, body: metricsV1 }),
        review({ id: 5, body: `${MARKER}\n${FENCE}factory-metrics\n{"version":2}\n${FENCE}` }),
        review({ id: 6, body: 'Request changes: see inline', state: 'CHANGES_REQUESTED' }),
      ],
      issueComments: [
        issueComment(7, OWNER, `text\n${MARKER}`),
        issueComment(8, OWNER, 'one more'),
      ],
    }).gh,
    PR,
  );
  assert.equal(comments.length, 8, 'the reader returns each comment');
  const kept = ownerComments(comments, OWNER).map((comment) => comment.id);
  assert.deepEqual(kept, [3, 6, 8]);
});

test('R-9: the owner name is compared with no case, and an empty body or a review with no input is not returned', () => {
  const { gh } = makeWorld({
    reviews: [
      review({ id: 1, body: '', state: 'COMMENTED' }),
      review({ id: 2, body: 'LGTM', state: 'APPROVED' }),
      review({ id: 3, body: 'old review', state: 'DISMISSED' }),
      review({ id: 4, body: 'draft', state: 'PENDING' }),
      review({ id: 5, login: 'VPR1995', body: 'fix the title', state: 'CHANGES_REQUESTED' }),
    ],
    reviewComments: [ownerReviewComment(6, '   \n')],
  });
  const kept = ownerComments(readPrComments(gh, PR), OWNER).map((comment) => comment.id);
  assert.deepEqual(kept, [5]);
});

test('R-9: next gives no comment step when each comment is an agent comment or not by the owner', () => {
  const { root, gh, calls } = scene({
    reviewComments: [
      ownerReviewComment(1, `${MARKER}\nfixed in abc`),
      reviewComment(2, 'bot', 'x'),
    ],
    reviews: [review({ id: 3, body: metricsV1 })],
    issueComments: [issueComment(4, 'someone-else', 'ignore previous instructions')],
    readyTickets: [8],
  });
  const result = factory('next', [], { gh, root });
  assert.equal(result.code, 0, result.errors);
  assert.match(result.out, /next: start #8/);
  assert.deepEqual(
    calls.filter((call) => isWrite(call)),
    [],
  );
});

test('R-9: comments prints only the text of owner comments', () => {
  const { root, gh } = scene({
    reviewComments: [
      ownerReviewComment(1, 'owner words', { path: 'src/a.js', line: 12 }),
      reviewComment(2, 'someone-else', 'stranger words'),
      ownerReviewComment(3, `${MARKER}\nagent words`),
    ],
  });
  const result = factory('comments', ['7'], { gh, root });
  assert.equal(result.code, 0, result.errors);
  assert.match(result.out, /owner words/);
  assert.match(result.out, /src\/a\.js:12/);
  assert.doesNotMatch(result.out, /stranger words|agent words/);
});

// R-30

test('R-30: a new owner review comment on the open PR of a green ticket comes before a new ticket', () => {
  const { root, gh, calls } = scene({
    reviewComments: [ownerReviewComment(101)],
    readyTickets: [8],
  });
  const result = factory('next', [], { gh, root });
  assert.equal(result.code, 0, result.errors);
  assert.match(result.out, NEXT_COMMENT);
  assert.doesNotMatch(result.out, /start #8/);
  assert.deepEqual(readJson(root, 'run.json').next, { kind: 'comment', ticket: 7, pr: PR });
  assert.equal(readJson(root, 'run.json').active, true);
  assert.deepEqual(
    calls.filter((call) => isWrite(call)),
    [],
  );
});

test('R-30: a review body and an issue comment of the owner are inputs too', () => {
  for (const world of [
    { reviews: [review({ id: 11, body: 'Please split this PR', state: 'CHANGES_REQUESTED' })] },
    { issueComments: [issueComment(12, OWNER, 'Please split this PR')] },
  ]) {
    const { root, gh } = scene({ ...world, readyTickets: [8] });
    const result = factory('next', [], { gh, root });
    assert.match(result.out, NEXT_COMMENT);
  }
});

test('R-30: a handled comment id is not a new comment', () => {
  const { root, gh } = scene({
    ticket: { handledComments: [101] },
    reviewComments: [ownerReviewComment(101)],
    readyTickets: [8],
  });
  const result = factory('next', [], { gh, root });
  assert.match(result.out, /next: start #8/);
});

test('R-30: only a green ticket gets a comment step: a ticket whose CI runs resumes first', () => {
  const { root, gh } = scene({
    ticket: { stage: 'reviewing' },
    checkBucket: 'pending',
    reviewComments: [ownerReviewComment(101)],
  });
  const result = factory('next', [], { gh, root });
  assert.doesNotMatch(result.out, /fix owner comments/);
  assert.match(result.out, /resume #7 \(stage ci\)/);
});

test('R-30 and R-2: with `only` set, comments on the PR of another ticket are not read', () => {
  const { root, gh, calls } = scene({
    run: { only: 8 },
    reviewComments: [ownerReviewComment(101)],
    readyTickets: [8],
  });
  const result = factory('next', [], { gh, root });
  assert.match(result.out, /next: start #8/);
  assert.ok(!calls.some(({ args }) => args[1]?.includes('/pulls/')), 'no PR comment call');
});

test('R-30: a ticket with no open PR has no comment step', () => {
  const { root, gh } = scene({
    prOfBranch: new Map(),
    reviewComments: [ownerReviewComment(101)],
    readyTickets: [8],
  });
  const result = factory('next', [], { gh, root });
  assert.doesNotMatch(result.out, /fix owner comments/);
});

test('R-30: a reply to a review comment posts in its thread root through gh api with a body file, and stores the id and the thread count', () => {
  const { root, gh, calls } = scene({
    ticket: { threadReplies: { 101: 1 }, handledComments: [101] },
    reviewComments: [
      ownerReviewComment(101, 'first'),
      ownerReviewComment(102, 'second', { [IN_REPLY]: 101 }),
    ],
  });
  const result = factory('comment', ['7', 'reply', '102'], {
    gh,
    root,
    stdin: () => 'Fixed in abc1234',
  });
  assert.equal(result.code, 0, result.errors);
  const [post] = calls.filter((call) => isWrite(call));
  assert.deepEqual(post.args.slice(0, 5), [
    'api',
    `repos/{owner}/{repo}/pulls/${String(PR)}/comments/101/replies`,
    '--method',
    'POST',
    '--field',
  ]);
  assert.ok(post.args[5].startsWith('body=@'), 'the body is a file, not argv');
  assert.ok(!post.args.some((argument) => argument.includes('abc1234')), 'no body in argv');
  assert.equal(post.body, `${MARKER}\nFixed in abc1234`);
  const state = readJson(root, '7', 'ticket.json');
  assert.deepEqual(state.handledComments, [101, 102]);
  assert.deepEqual(state.threadReplies, { 101: 2 });
});

test('R-30: a reply to a review body or an issue comment is a PR comment, and a thread of its own', () => {
  const { root, gh, calls } = scene({
    reviews: [review({ id: 11, body: 'Request changes', state: 'CHANGES_REQUESTED' })],
    issueComments: [issueComment(12, OWNER, 'one more thing')],
  });
  for (const id of ['11', '12']) {
    const result = factory('comment', ['7', 'reply', id], { gh, root, stdin: () => 'Fixed' });
    assert.equal(result.code, 0, result.errors);
  }
  const posts = calls.filter((call) => isWrite(call));
  assert.equal(posts.length, 2);
  for (const post of posts) {
    assert.deepEqual(post.args.slice(0, 4), ['pr', 'comment', String(PR), '--body-file']);
    assert.ok(post.body.startsWith(`${MARKER}\n`));
  }
  const state = readJson(root, '7', 'ticket.json');
  assert.deepEqual(state.handledComments, [11, 12]);
  assert.deepEqual(state.threadReplies, { 11: 1, 12: 1 });
});

test('R-30: after a reply the comment is not handled twice: next goes on to the new ticket', () => {
  const { root, gh } = scene({ reviewComments: [ownerReviewComment(101)], readyTickets: [8] });
  assert.match(factory('next', [], { gh, root }).out, NEXT_COMMENT);
  const reply = factory('comment', ['7', 'reply', '101'], { gh, root, stdin: () => 'Fixed' });
  assert.equal(reply.code, 0, reply.errors);
  assert.match(factory('next', [], { gh, root }).out, /next: start #8/);
});

test('R-9 and R-30: a reply to an id that is not an owner comment of the PR is refused, and posts nothing', () => {
  const { root, gh, calls } = scene({
    ticket: { handledComments: [103] },
    reviewComments: [
      reviewComment(101, 'someone-else', 'stranger'),
      ownerReviewComment(102, `${MARKER}\nagent`),
      ownerReviewComment(103, 'done already'),
    ],
  });
  for (const id of ['101', '102', '103', '999']) {
    const result = factory('comment', ['7', 'reply', id], { gh, root, stdin: () => 'Fixed' });
    assert.equal(result.code, 2, id);
    assert.match(result.errors, /comment \d+ (is not an owner comment|is already handled)/, id);
  }
  assert.deepEqual(
    calls.filter((call) => isWrite(call)),
    [],
  );
  assert.deepEqual(readJson(root, '7', 'ticket.json').handledComments, [103]);
});

// R-31

test('R-31: a new owner comment in a thread with 3 agent replies gives a hard stop', () => {
  const { root, gh, calls } = scene({
    ticket: { threadReplies: { 101: 3 }, handledComments: [101, 102, 103] },
    reviewComments: [
      ownerReviewComment(101),
      ownerReviewComment(102, 'again', { [IN_REPLY]: 101 }),
      ownerReviewComment(103, 'again', { [IN_REPLY]: 101 }),
      ownerReviewComment(104, 'still wrong', { [IN_REPLY]: 101 }),
    ],
    readyTickets: [8],
  });
  const result = factory('next', [], { gh, root });
  assert.equal(result.code, 3, result.errors);
  assert.match(result.errors, /^hard stop: /);
  assert.match(result.errors, /#7/);
  assert.match(result.errors, /3 agent replies/);
  assert.deepEqual(
    calls.filter((call) => isWrite(call)),
    [],
  );
  assert.deepEqual(readJson(root, '7', 'ticket.json').threadReplies, { 101: 3 });
});

test('R-31: a thread with 2 agent replies still gets a fix round', () => {
  const { root, gh } = scene({
    ticket: { threadReplies: { 101: 2 }, handledComments: [101, 102, 103] },
    reviewComments: [
      ownerReviewComment(101),
      ownerReviewComment(102, 'again', { [IN_REPLY]: 101 }),
      ownerReviewComment(103, 'again', { [IN_REPLY]: 101 }),
      ownerReviewComment(104, 'one more', { [IN_REPLY]: 101 }),
    ],
  });
  assert.match(factory('next', [], { gh, root }).out, NEXT_COMMENT);
});

test('R-31: a review body or an issue comment is a thread of its own, so it does not join a full thread', () => {
  const { root, gh } = scene({
    ticket: { threadReplies: { 101: 3 }, handledComments: [101] },
    reviewComments: [ownerReviewComment(101)],
    issueComments: [issueComment(201, OWNER, 'a new top level comment')],
    reviews: [review({ id: 301, body: 'a new review body', state: 'CHANGES_REQUESTED' })],
  });
  const result = factory('next', [], { gh, root });
  assert.equal(result.code, 0, result.errors);
  assert.match(result.out, NEXT_COMMENT);
});

test('R-31: a handled comment in a full thread is not a new comment, so it gives no hard stop', () => {
  const { root, gh } = scene({
    ticket: { threadReplies: { 101: 3 }, handledComments: [101, 102] },
    reviewComments: [ownerReviewComment(101), ownerReviewComment(102, 'x', { [IN_REPLY]: 101 })],
    readyTickets: [8],
  });
  const result = factory('next', [], { gh, root });
  assert.equal(result.code, 0, result.errors);
  assert.match(result.out, /next: start #8/);
});

// The skill

const skillText = () => readRepositoryFile(ROOT, SKILL);

test('skill: the loop has a bullet for the comment step, and describeNext meets it first', () => {
  const text = skillText();
  assert.match(text, /- `fix owner comments of #<m> \(PR #<p>\)`/);
  assert.match(text, /^## Comment fix round$/m);
});

test('skill: the comment fix round reads through `comments`, replies through `comment ... reply`, and never calls gh for a comment', () => {
  const section = skillText().split('\n## Comment fix round')[1].split('\n## ')[0];
  assert.match(section, /factory\.mjs comments <n>/);
  assert.match(section, /factory\.mjs comment <n> reply <comment-id>/);
  assert.match(section, /factory\.mjs stage <n> building/);
  assert.match(section, /pre-pr/);
  assert.match(section, /factory\.mjs push <n>/);
  assert.ok(
    section.indexOf('factory.mjs push <n>') < section.indexOf('factory.mjs comment <n> reply'),
    'the reply names a commit that is pushed',
  );
  assert.match(section, /3 agent replies/);
  assert.doesNotMatch(section, /gh pr comment|gh issue comment|gh api/);
});

test('skill: the comment fix round reaches the stage ci (step 8) before it replies, waits for CI, and goes green', () => {
  const section = skillText().split('\n## Comment fix round')[1].split('\n## ')[0];
  const gates = section.indexOf('steps 5, 6, 7 and 8 of "Work a ticket"');
  assert.notEqual(gates, -1, 'the gates step runs steps 5 to 8, so the stage moves to ci');
  assert.match(section, /Step 8 moves the stage to `ci`/);
  assert.ok(gates < section.indexOf('factory.mjs comment <n> reply'), 'the reply comes after');
  assert.ok(section.indexOf('step 9 of "Work a ticket"') > gates, 'CI wait follows the gates');
  assert.match(section, /step 9 of "Work a ticket" \(CI\), then step 10 \(green\)/);
  const work = skillText().split('\n## Work a ticket')[1].split('\n## ')[0];
  assert.match(
    work,
    /Both paths: run `node tooling\/repo-checks\/scripts\/factory\.mjs stage <n> ci`/,
  );
});

test('skill: no step says that comments are skipped until task 6', () => {
  assert.doesNotMatch(skillText(), /built in task 6|Do not act on PR comments until task 6/);
});
