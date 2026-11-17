// Tests for `comment`, `hardstop` and `caps` of scripts/factory.mjs (design factory-daily-run 4.1,
// R-8, R-12, R-15, R-16, R-51, R-55). `gh` is a stub that records each call and the --body-file
// text at call time. Git is real: temp repos with a local bare remote. No test calls the real gh
// or the network.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { main } from '../scripts/factory.mjs';
import { MARKER, redactText } from '../scripts/lib/factory-comment.mjs';
import { HardStopError } from '../scripts/lib/factory-github.mjs';
import { listFolder, readOptional, writeAtomic } from '../scripts/lib/fs-io.mjs';

import { pathFromEnv } from './test-env.config.js';

const STATE = '.claude/factory';
const REASON = 'verify failed after 3 fix rounds';
const BOARD_FIELDS = {
  fields: [
    {
      id: 'F_STATUS',
      name: 'Status',
      options: [
        { id: 'o-backlog', name: 'Backlog' },
        { id: 'o-progress', name: 'In progress' },
      ],
    },
  ],
};
const REPOSITORY = 'vpr1995/projects-monorepo';
const ITEMS = { items: [{ id: 'I_7', content: { number: 7, repository: REPOSITORY } }] };
const MINUTE = 60_000;
const roots = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const temporaryFolder = () => {
  const root = mkdtempSync(path.join(tmpdir(), 'factory-caps-'));
  roots.push(root);
  return root;
};

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

/** A work repo on feat/7-x (one commit ahead of main) with a bare remote that holds main. */
function makeRepository() {
  const folder = temporaryFolder();
  const remote = path.join(folder, 'remote.git');
  const work = path.join(folder, 'work');
  git(folder, 'init', '-q', '--bare', '-b', 'main', remote);
  git(folder, 'init', '-q', '-b', 'main', work);
  git(work, 'config', 'commit.gpgsign', 'false');
  git(work, 'config', 'core.hooksPath', '/dev/null');
  git(work, 'remote', 'add', 'origin', remote);
  commitFile(work, 'README.md', 'hello\n');
  commitFile(work, 'src/a.js', 'export const a = 0;\n');
  git(work, 'push', '-q', 'origin', 'main');
  git(work, 'checkout', '-q', '-b', 'feat/7-x');
  commitFile(work, 'src/b.js', 'export const b = 1;\n');
  return { folder, remote, work };
}

const stateFile = (root, ...parts) => path.join(root, STATE, ...parts);
const seedTicket = (root, extra = {}, ticket = 7) =>
  writeAtomic(
    stateFile(root, String(ticket), 'ticket.json'),
    JSON.stringify({
      issue: ticket,
      stage: 'building',
      branch: 'feat/7-x',
      base: null,
      restartedAt: null,
      resumes: 0,
      ...extra,
    }),
  );
const readTicket = (root) => JSON.parse(readFileSync(stateFile(root, '7', 'ticket.json'), 'utf8'));
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z');
const T0 = Date.parse('2026-11-17T08:00:00Z');
const lineOf = (ticket, ms, extra = {}) =>
  JSON.stringify({
    ts: iso(ms),
    ticket,
    event: 'stage',
    from: null,
    to: null,
    detail: '',
    ...extra,
  });
const logLine = (ms, event = 'stage', detail = '') => lineOf(7, ms, { event, detail });
const seedLog = (root, lines, name = 'adhoc') =>
  writeAtomic(stateFile(root, 'runs', `${name}.jsonl`), `${lines.join('\n')}\n`);

/** A gh stub. `replies` maps the first two words to a reply or a function. Records each call. */
function makeGh(replies = {}) {
  const calls = [];
  const known = {
    'project field-list': JSON.stringify(BOARD_FIELDS),
    'project item-list': JSON.stringify(ITEMS),
    'project view': JSON.stringify({ id: 'PVT_2' }),
    'repo view': `${REPOSITORY}\n`,
    ...replies,
  };
  const gh = (args) => {
    const at = args.indexOf('--body-file');
    const body = at === -1 ? undefined : readFileSync(args[at + 1], 'utf8');
    calls.push({ args, body });
    const reply = known[args.slice(0, 2).join(' ')] ?? '';
    return typeof reply === 'function' ? reply(args) : reply;
  };
  return { gh, calls };
}

const writes = (calls) =>
  calls.filter(
    ({ args }) => args[1] === 'edit' || args[1] === 'comment' || args[1] === 'item-edit',
  );
const comments = (calls) => calls.filter(({ args }) => args[1] === 'comment');

/** Runs one factory command in process. Returns the exit code and the text of stdout and stderr. */
function runFactory(argv, overrides) {
  const out = [];
  const errors = [];
  const code = main(['node', 'factory.mjs', ...argv], {
    stdin: () => '',
    now: () => new Date('2026-11-17T10:00:00Z'),
    guard: () => {
      throw new Error('the local test guard must not run');
    },
    ...overrides,
    print: (text) => out.push(text),
    err: (text) => errors.push(text),
  });
  return { code, out: out.join(''), errors: errors.join('') };
}

// comment (R-8)

test('R-8: comment posts the body from stdin through a body file, first line is the marker', () => {
  const { work } = makeRepository();
  const { gh, calls } = makeGh();
  const body = 'Plain `code` and ```fence``` with $(rm -rf /) and "quotes"\nsecond line';
  const result = runFactory(['comment', '7'], { root: work, gh, stdin: () => body });
  assert.equal(result.code, 0, result.errors);
  assert.equal(calls.length, 1);
  const [{ args, body: posted }] = calls;
  assert.deepEqual(args.slice(0, 4), ['issue', 'comment', '7', '--body-file']);
  assert.ok(posted.startsWith(`${MARKER}\n`), posted);
  assert.ok(posted.includes(body));
  for (const argument of args) assert.ok(!argument.includes('code'), 'body must not be in argv');
});

test('R-8: comment --pr posts on the pull request, and a body with the marker gets no second one', () => {
  const { work } = makeRepository();
  const { gh, calls } = makeGh();
  const result = runFactory(['comment', '7', '--pr', '12'], {
    root: work,
    gh,
    stdin: () => `${MARKER}\nalready marked`,
  });
  assert.equal(result.code, 0, result.errors);
  assert.deepEqual(calls[0].args.slice(0, 4), ['pr', 'comment', '12', '--body-file']);
  assert.equal(calls[0].body, `${MARKER}\nalready marked`);
});

test('R-8: comment refuses an empty body and a bad --pr value, and calls no gh', () => {
  const { work } = makeRepository();
  const { gh, calls } = makeGh();
  const empty = runFactory(['comment', '7'], { root: work, gh });
  assert.equal(empty.code, 2);
  assert.match(empty.errors, /comment body is empty/);
  for (const flags of [['--pr', 'x'], ['--bad'], ['--pr']]) {
    const bad = runFactory(['comment', '7', ...flags], { root: work, gh, stdin: () => 'a' });
    assert.equal(bad.code, 2, flags.join(' '));
    assert.match(bad.errors, /Usage: comment <n> \[--pr <m>\]/, flags.join(' '));
  }
  assert.equal(calls.length, 0);
});

test('R-8: comment redacts and caps the body at 60,000 characters, marker included', () => {
  const { work } = makeRepository();
  const { gh, calls } = makeGh();
  const body = `token=abc123\n${'x'.repeat(70_000)}`;
  assert.equal(runFactory(['comment', '7'], { root: work, gh, stdin: () => body }).code, 0);
  const { body: posted } = calls[0];
  assert.ok(posted.length <= 60_000, String(posted.length));
  assert.ok(posted.startsWith(`${MARKER}\n[redacted]`));
  assert.ok(!posted.includes('abc123'));
});

// redaction (design 4.1)

test('redaction: each pattern of design 4.1 is replaced with [redacted] and home paths with ~', () => {
  const aws = `AKIA${'A1B2C3D4E5F6G7H8'}`;
  const github = `ghp_${'a1B2'.repeat(9)}`;
  const apiKey = `sk-${'abcDEF123_-'.repeat(2)}`;
  const cases = [
    [`key ${aws} end`, aws],
    [`token ${github} end`, github],
    [`key ${apiKey} end`, apiKey],
    ['PASSWORD: hunter2', 'hunter2'],
    ['secret = s3cr3t', 's3cr3t'],
    ['api_key=abc123', 'abc123'],
    ['API-KEY: abc123', 'abc123'],
    ['apikey=abc123', 'abc123'],
    ['Token:abc123', 'abc123'],
  ];
  for (const [input, secret] of cases) {
    const text = redactText(input);
    assert.ok(!text.includes(secret), `${input} -> ${text}`);
    assert.match(text, /\[redacted\]/, input);
  }
  assert.equal(redactText('at /Users/bob/code/a.js:1'), 'at ~/code/a.js:1');
  assert.equal(redactText('at /home/alice/x and /Users/bob'), 'at ~/x and ~');
  assert.equal(redactText('no secrets here: 12 lines'), 'no secrets here: 12 lines');
});

test('redaction: a private key block is removed up to its END line, or to the end of the text', () => {
  // Built from parts, so the secret scanner of the pre-commit hook does not flag this test file.
  const header = ['-----BEGIN RSA', 'PRIVATE KEY-----'].join(' ');
  const footer = ['-----END RSA', 'PRIVATE KEY-----'].join(' ');
  const whole = redactText(`a\n${header}\nMIIBOgIBAAJBAKj34GkxFhD90\n${footer}\nb`);
  assert.equal(whole, 'a\n[redacted]\nb');
  const cut = redactText(`a\n${header}\nMIIBOgIBAAJBAKj34GkxFhD90\nmore`);
  assert.equal(cut, 'a\n[redacted]');
  assert.ok(!redactText(`${['-----BEGIN', 'PRIVATE KEY-----'].join(' ')}\nMIIB`).includes('MIIB'));
});

test('redaction: tokens and URL credentials that failureReason knows are removed too', () => {
  const pat = `github_pat_${'x_Y9'.repeat(6)}`;
  const text = redactText(`fetch https://user:pass@github.com/a/b.git ${pat}`);
  for (const secret of ['user:pass', pat]) assert.ok(!text.includes(secret), secret);
});

// hardstop (R-12)

const hardstopOverrides = (work, extra = {}) => {
  let step = 0;
  const { gh, calls } = makeGh(extra.replies);
  return {
    calls,
    overrides: {
      root: work,
      gh,
      now: () => new Date(Date.parse('2026-11-17T10:00:00Z') + step++ * MINUTE),
      ...extra.overrides,
    },
  };
};

const dirty = (work) => {
  writeFileSync(path.join(work, 'src/b.js'), 'export const b = 2;\n');
  writeFileSync(path.join(work, 'notes.txt'), 'untracked note\n');
  writeFileSync(path.join(work, 'ignored.log'), 'ignored\n');
  writeFileSync(path.join(work, '.gitignore'), 'ignored.log\n.claude/factory/\n');
  git(work, 'add', '-N', '.gitignore');
};

const logsFolder = (work) => stateFile(work, '7', 'logs');
const patches = (work) => listFolder(logsFolder(work)).filter((name) => name.endsWith('.patch'));

test('R-12: the steps run in order, push needs no guard, and nothing opens a PR', () => {
  const { remote, work } = makeRepository();
  seedTicket(work);
  seedLog(work, [logLine(T0)]);
  dirty(work);
  const seen = [];
  const { calls, overrides } = hardstopOverrides(work, {
    replies: {
      'issue edit': () => {
        seen.push(['labels', git(remote, 'branch', '--list', 'feat/7-x').trim()]);
        return '';
      },
      'issue comment': () => {
        seen.push([
          'comment',
          git(remote, 'rev-parse', 'feat/7-x').trim() === git(work, 'rev-parse', 'HEAD').trim(),
          patches(work).length,
        ]);
        return '';
      },
    },
    overrides: { stdin: () => 'line one\nerror: /Users/bob/x token=abc' },
  });
  const result = runFactory(['hardstop', '7', REASON], overrides);
  assert.equal(result.code, 0, result.errors);
  // 1 labels before the push, 4 comment after the push and the patch.
  assert.deepEqual(seen, [
    ['labels', ''],
    ['comment', true, 1],
  ]);
  const order = [...result.out.matchAll(/^step (\d) (\w+):/gm)].map(
    (match) => `${match[1]} ${match[2]}`,
  );
  assert.deepEqual(order, [
    '1 labels',
    '2 push',
    '3 patch',
    '4 comment',
    '5 metrics',
    '6 report',
    '7 clear',
  ]);
  assert.match(result.out, /step 5 metrics: not built yet \(task 5\)/);
  assert.match(result.out, /step 6 report: not built yet \(task 2c\)/);
  assert.match(result.out, /step 7 clear: not built yet \(task 2c\)/);
  const lines = result.out.trimEnd().split('\n');
  assert.equal(
    lines.at(-1),
    'Next: node tooling/repo-checks/scripts/stop-gate.mjs defer "<reason>"',
  );
  assert.ok(
    calls.every(({ args }) => args[0] !== 'pr'),
    'no PR call',
  );
  const edit = calls.find(({ args }) => args[0] === 'issue' && args[1] === 'edit');
  assert.deepEqual(edit.args, [
    'issue',
    'edit',
    '7',
    '--add-label',
    'needs-human',
    '--remove-label',
    'agent:in-progress',
  ]);
  const board = calls.find(({ args }) => args[1] === 'item-edit');
  assert.ok(board.args.includes('o-backlog'), 'board status Backlog');
  assert.equal(readTicket(work).stage, 'needs-human');
  const events = readFileSync(stateFile(work, 'runs', 'adhoc.jsonl'), 'utf8')
    .trimEnd()
    .split('\n')
    .map(JSON.parse);
  const detail = events.filter((entry) => entry.event === 'stop').map((entry) => entry.detail);
  assert.equal(detail.length, 4);
  assert.deepEqual(
    events.filter((entry) => entry.event === 'skip').map((entry) => entry.detail),
    [
      'step 5 metrics: skipped: task 5',
      'step 6 report: skipped: task 2c',
      'step 7 clear: skipped: task 2c',
    ],
  );
});

test('R-12: the posted comment has the marker, reason, branch, patch name, and a redacted excerpt', () => {
  const { work } = makeRepository();
  seedTicket(work);
  seedLog(work, [logLine(T0)]);
  dirty(work);
  const excerpt = ['failure at /Users/bob/code/a.js', 'password=hunter2', 'last line'].join('\n');
  const { calls, overrides } = hardstopOverrides(work, { overrides: { stdin: () => excerpt } });
  assert.equal(runFactory(['hardstop', '7', REASON], overrides).code, 0);
  const [{ body, args }] = comments(calls);
  assert.deepEqual(args.slice(0, 3), ['issue', 'comment', '7']);
  assert.ok(body.startsWith(`${MARKER}\n`));
  assert.ok(body.includes(REASON));
  assert.ok(body.includes('feat/7-x'));
  assert.ok(body.includes(patches(work)[0]));
  assert.ok(body.includes('~/code/a.js'));
  assert.ok(!body.includes('/Users/bob') && !body.includes('hunter2'));
  assert.ok(body.includes('last line'));
});

test('R-12: the excerpt keeps the last 40 lines and says how many were cut', () => {
  const { work } = makeRepository();
  seedTicket(work);
  seedLog(work, [logLine(T0)]);
  const excerpt = Array.from({ length: 100 }, (_, index) => `row ${String(index + 1)}`).join('\n');
  const { calls, overrides } = hardstopOverrides(work, { overrides: { stdin: () => excerpt } });
  assert.equal(runFactory(['hardstop', '7', REASON], overrides).code, 0);
  const [{ body }] = comments(calls);
  const rows = body.split('\n').filter((line) => /^row \d+$/.test(line));
  assert.equal(rows.length, 40);
  assert.equal(rows[0], 'row 61');
  assert.equal(rows.at(-1), 'row 100');
  assert.match(body, /last 40 of 100 lines/);
});

test('R-12: a reason that ends in token: cannot swallow the closing fence', () => {
  const { work } = makeRepository();
  seedTicket(work);
  seedLog(work, [logLine(T0)]);
  const excerpt = 'cannot find module\n@vprprudhvi/tooling-repo-checks';
  const { calls, overrides } = hardstopOverrides(work, { overrides: { stdin: () => excerpt } });
  assert.equal(runFactory(['hardstop', '7', 'bad token:'], overrides).code, 0);
  const lines = comments(calls)[0].body.split('\n');
  const mention = lines.indexOf('@vprprudhvi/tooling-repo-checks');
  assert.ok(mention > 0);
  const fences = lines
    .map((line, index) => (line === '```' ? index : -1))
    .filter((position) => position >= 0);
  assert.equal(fences.length, 4, 'reason fence pair and excerpt fence pair');
  assert.ok(fences[2] < mention && mention < fences[3], 'the @name sits inside the excerpt fence');
});

test('R-12: a private key that starts early in a long excerpt is gone, also the lines after the cut', () => {
  const { work } = makeRepository();
  seedTicket(work);
  seedLog(work, [logLine(T0)]);
  const body = Array.from({ length: 60 }, (_, index) => `KEYBODY${String(index)}`);
  const header = ['-----BEGIN RSA', 'PRIVATE KEY-----'].join(' ');
  const excerpt = ['start', header, ...body].join('\n');
  const { calls, overrides } = hardstopOverrides(work, { overrides: { stdin: () => excerpt } });
  assert.equal(runFactory(['hardstop', '7', REASON], overrides).code, 0);
  const { body: posted } = comments(calls)[0];
  assert.ok(!posted.includes('KEYBODY'), 'no key line in the comment');
  assert.ok(posted.includes('[redacted]'));
  const unterminated = hardstopOverrides(work);
  assert.equal(runFactory(['hardstop', '7', `x ${header}`], unterminated.overrides).code, 0);
  assert.match(
    comments(unterminated.calls)[0].body,
    /Branch: `feat\/7-x`/,
    'text after the reason stays',
  );
});

test('R-12: a fence in the excerpt cannot close the code block, and @names sit inside the fence', () => {
  const { work } = makeRepository();
  seedTicket(work);
  seedLog(work, [logLine(T0)]);
  const excerpt = '```\n@vprprudhvi/tooling-repo-checks failed\n````';
  const { calls, overrides } = hardstopOverrides(work, { overrides: { stdin: () => excerpt } });
  assert.equal(runFactory(['hardstop', '7', REASON], overrides).code, 0);
  const [{ body }] = comments(calls);
  const fence = body.split('\n').find((line) => /^`{5,}$/.test(line));
  assert.ok(fence !== undefined, 'fence longer than any backtick run in the excerpt');
  const lines = body.split('\n');
  const open = lines.indexOf(fence);
  const close = lines.lastIndexOf(fence);
  assert.ok(open < lines.indexOf('@vprprudhvi/tooling-repo-checks failed'));
  assert.ok(close > lines.indexOf('@vprprudhvi/tooling-repo-checks failed'));
  assert.ok(!lines.slice(0, open).some((line) => line.includes('@vprprudhvi')));
});

test('R-12: the patch has changes and untracked files, skips ignored files, and keeps tree and index', () => {
  const { folder, remote, work } = makeRepository();
  seedTicket(work);
  seedLog(work, [logLine(T0)]);
  dirty(work);
  const statusBefore = git(work, 'status', '--porcelain', '--untracked-files=all');
  const indexBefore = git(work, 'ls-files', '--stage');
  const { overrides } = hardstopOverrides(work);
  assert.equal(runFactory(['hardstop', '7', REASON], overrides).code, 0);
  assert.equal(git(work, 'status', '--porcelain', '--untracked-files=all'), statusBefore);
  assert.equal(git(work, 'ls-files', '--stage'), indexBefore);
  const [name] = patches(work);
  assert.match(name, /^hardstop-\d{8}T\d{6}Z\.patch$/);
  const text = readFileSync(path.join(logsFolder(work), name), 'utf8');
  assert.match(text, /export const b = 2;/);
  assert.match(text, /untracked note/);
  assert.ok(!text.includes('diff --git a/ignored.log'), 'ignored file must not be in the patch');
  assert.ok(
    !text.includes('diff --git a/.claude/factory'),
    'state folder must not be in the patch',
  );
  const clone = path.join(folder, 'clone');
  git(folder, 'clone', '-q', '--branch', 'feat/7-x', remote, clone);
  git(clone, 'apply', '--check', path.join(logsFolder(work), name));
  git(clone, 'apply', path.join(logsFolder(work), name));
  assert.equal(readFileSync(path.join(clone, 'notes.txt'), 'utf8'), 'untracked note\n');
});

test('R-12: with no change and no untracked file there is no patch and the comment says none', () => {
  const { work } = makeRepository();
  seedTicket(work);
  seedLog(work, [logLine(T0)]);
  const { calls, overrides } = hardstopOverrides(work);
  const result = runFactory(['hardstop', '7', REASON], overrides);
  assert.equal(result.code, 0, result.errors);
  assert.deepEqual(patches(work), []);
  assert.match(result.out, /step 3 patch: nothing to save/);
  assert.match(comments(calls)[0].body, /Patch: none/);
});

test('R-12: a second run changes nothing: no gh write, no second patch, same files', () => {
  const { remote, work } = makeRepository();
  seedTicket(work);
  seedLog(work, [logLine(T0)]);
  dirty(work);
  const first = hardstopOverrides(work);
  assert.equal(runFactory(['hardstop', '7', REASON], first.overrides).code, 0);
  assert.equal(comments(first.calls).length, 1);
  const before = {
    ticket: readFileSync(stateFile(work, '7', 'ticket.json'), 'utf8'),
    patches: patches(work),
    remote: git(remote, 'rev-parse', 'feat/7-x'),
    status: git(work, 'status', '--porcelain', '--untracked-files=all'),
  };
  const second = hardstopOverrides(work);
  const result = runFactory(['hardstop', '7', REASON], second.overrides);
  assert.equal(result.code, 0, result.errors);
  assert.deepEqual(writes(second.calls), []);
  assert.deepEqual(second.calls, [], 'step 1 and step 4 make no gh call at all');
  assert.deepEqual(patches(work), before.patches);
  assert.equal(readFileSync(stateFile(work, '7', 'ticket.json'), 'utf8'), before.ticket);
  assert.equal(git(remote, 'rev-parse', 'feat/7-x'), before.remote);
  assert.equal(git(work, 'status', '--porcelain', '--untracked-files=all'), before.status);
  assert.match(result.out, /step 1 labels: already needs-human/);
  assert.match(result.out, /step 4 comment: already posted/);
});

test('R-12: the comment flag is in ticket.json when the ticket has state, and keeps the other keys', () => {
  const { work } = makeRepository();
  seedTicket(work, { pr: 12 });
  seedLog(work, [logLine(T0)]);
  const { overrides } = hardstopOverrides(work);
  assert.equal(runFactory(['hardstop', '7', REASON], overrides).code, 0);
  const state = readTicket(work);
  assert.match(state.hardStop.commentKey, /^0:[0-9a-f]{64}$/);
  assert.equal(state.pr, 12);
  assert.equal(state.stage, 'needs-human');
  assert.equal(readOptional(stateFile(work, '7', 'hardstop.json')), undefined);
});

test('R-12: a changed working tree makes a new patch, and a new reason makes a new comment', () => {
  const { work } = makeRepository();
  seedTicket(work);
  seedLog(work, [logLine(T0)]);
  dirty(work);
  const first = hardstopOverrides(work);
  assert.equal(runFactory(['hardstop', '7', REASON], first.overrides).code, 0);
  writeFileSync(path.join(work, 'notes.txt'), 'untracked note, changed\n');
  const second = hardstopOverrides(work);
  assert.equal(runFactory(['hardstop', '7', 'CI timeout'], second.overrides).code, 0);
  assert.equal(patches(work).length, 2);
  assert.equal(comments(second.calls).length, 1);
  assert.ok(comments(second.calls)[0].body.includes('CI timeout'));
});

test('R-12: after the owner restarts the ticket, the same reason posts a comment again', () => {
  const { work } = makeRepository();
  seedTicket(work);
  seedLog(work, [logLine(T0)]);
  const first = hardstopOverrides(work);
  assert.equal(runFactory(['hardstop', '7', REASON], first.overrides).code, 0);
  seedTicket(work, { stage: 'building', resumes: 1 });
  const second = hardstopOverrides(work);
  assert.equal(runFactory(['hardstop', '7', REASON], second.overrides).code, 0);
  assert.equal(comments(second.calls).length, 1);
});

test('R-12: a failed comment is not recorded, so the next run posts it', () => {
  const { work } = makeRepository();
  seedTicket(work);
  seedLog(work, [logLine(T0)]);
  const failing = hardstopOverrides(work, {
    replies: {
      'issue comment': () => {
        throw new HardStopError('gh issue comment failed twice: network');
      },
    },
  });
  const result = runFactory(['hardstop', '7', REASON], failing.overrides);
  assert.equal(result.code, 2);
  assert.match(result.out, /step 4 comment: FAILED: .*network/);
  assert.match(result.out, /step 7 clear: not built yet/, 'later steps still run');
  assert.match(result.errors, /steps failed: 4 comment/);
  const retry = hardstopOverrides(work);
  assert.equal(runFactory(['hardstop', '7', REASON], retry.overrides).code, 0);
  assert.equal(comments(retry.calls).length, 1);
});

test('R-12: with no ticket state labels are edited directly, and a second run posts nothing', () => {
  const { work } = makeRepository();
  const first = hardstopOverrides(work);
  const result = runFactory(['hardstop', '7', REASON], first.overrides);
  assert.equal(result.code, 0, result.errors);
  assert.deepEqual(first.calls[0].args, [
    'issue',
    'edit',
    '7',
    '--add-label',
    'needs-human',
    '--remove-label',
    'agent:in-progress',
  ]);
  assert.equal(comments(first.calls).length, 1);
  assert.equal(readOptional(stateFile(work, '7', 'ticket.json')), undefined);
  const second = hardstopOverrides(work);
  assert.equal(runFactory(['hardstop', '7', REASON], second.overrides).code, 0);
  assert.equal(comments(second.calls).length, 0);
  // The label edit is safe to send again: it leaves the labels as they are.
  assert.deepEqual(
    writes(second.calls).map(({ args }) => args[1]),
    ['edit'],
  );
  assert.ok(
    existsSync(stateFile(work, '7', 'hardstop.json')),
    'flag file for a ticket with no state',
  );
});

test('R-12: a ticket in stage done fails step 1 loudly, and the other steps still run', () => {
  const { work } = makeRepository();
  seedTicket(work, { stage: 'done' });
  seedLog(work, [logLine(T0)]);
  const { calls, overrides } = hardstopOverrides(work);
  const result = runFactory(['hardstop', '7', REASON], overrides);
  assert.equal(result.code, 2);
  assert.match(result.out, /step 1 labels: FAILED: illegal stage move: done -> needs-human/);
  assert.equal(comments(calls).length, 1);
});

test('R-12: hardstop needs a reason and a ticket number, and runs no step without them', () => {
  const { work } = makeRepository();
  const { overrides, calls } = hardstopOverrides(work);
  const usage = [
    [['hardstop', '7'], /Usage: hardstop <n>/],
    [['hardstop', '7', ''], /Usage: hardstop <n>/],
    [['hardstop', '7', REASON, 'extra'], /Usage: hardstop <n>/],
    [['hardstop', 'x', REASON], /ticket number must be a positive integer/],
  ];
  for (const [argv, message] of usage) {
    const result = runFactory(argv, overrides);
    assert.equal(result.code, 2, argv.join(' '));
    assert.match(result.errors, message, argv.join(' '));
    assert.equal(result.out, '', 'no step runs');
  }
  assert.deepEqual(calls, []);
});

// R-55

/** The remote branch changed src/a.js, and the local branch changed it too: a merge conflict. */
function makeConflict() {
  const repository = makeRepository();
  const { folder, remote, work } = repository;
  git(work, 'push', '-q', 'origin', 'feat/7-x');
  const other = path.join(folder, 'other');
  git(folder, 'clone', '-q', remote, other);
  git(other, 'checkout', '-q', 'feat/7-x');
  commitFile(other, 'src/a.js', 'export const a = "remote";\n');
  git(other, 'push', '-q', 'origin', 'feat/7-x');
  commitFile(work, 'src/a.js', 'export const a = "local";\n');
  return repository;
}

test('R-55: a merge conflict in push aborts the merge, exits 3, and lists the paths', () => {
  const { work } = makeConflict();
  seedTicket(work);
  const result = runFactory(['push', '7'], { root: work, gh: () => '', guard: () => [] });
  assert.equal(result.code, 3);
  assert.match(result.errors, /^hard stop: .*Merge aborted\. Conflicts: src\/a\.js/);
  assert.equal(git(work, 'status', '--porcelain', '--untracked-files=no'), '');
  assert.ok(!existsSync(path.join(work, '.git', 'MERGE_HEAD')));
});

test('R-55: the reason of the push hard stop reaches the hardstop comment with the paths', () => {
  const { work } = makeConflict();
  seedTicket(work);
  const push = runFactory(['push', '7'], { root: work, gh: () => '', guard: () => [] });
  const reason = push.errors.replace(/^hard stop: /, '').trim();
  const { calls, overrides } = hardstopOverrides(work);
  // Step 2 hits the same conflict, so the command exits 2. The comment is still posted.
  assert.equal(runFactory(['hardstop', '7', reason], overrides).code, 2);
  assert.match(comments(calls)[0].body, /Conflicts: src\/a\.js/);
});

test('R-55: a conflict in step 2 of hardstop is a failed step with the paths, and later steps run', () => {
  const { work } = makeConflict();
  seedTicket(work);
  seedLog(work, [logLine(T0)]);
  const { calls, overrides } = hardstopOverrides(work);
  const result = runFactory(['hardstop', '7', REASON], overrides);
  assert.equal(result.code, 2);
  assert.match(result.out, /step 2 push: FAILED: .*Conflicts: src\/a\.js/);
  assert.match(result.out, /step 4 comment: posted/);
  assert.match(result.out, /defer "<reason>"/, 'the defer line is printed after a failure too');
  assert.equal(comments(calls).length, 1);
  assert.equal(git(work, 'status', '--porcelain', '--untracked-files=no'), '');
});

// caps (R-15, R-16, R-51)

const run = (conclusion, minutes) => ({ conclusion, createdAt: iso(T0 + minutes * MINUTE) });

function capsFixture({ runs = [], lines = [logLine(T0)], ticket = {}, replies = {} } = {}) {
  const { work } = makeRepository();
  seedTicket(work, ticket);
  if (lines !== null) seedLog(work, lines);
  const { gh, calls } = makeGh({
    'run list': JSON.stringify(runs),
    ...replies,
  });
  const caps = () => {
    const result = runFactory(['caps', '7'], { root: work, gh });
    return { ...result, json: result.out.trim() === '' ? undefined : JSON.parse(result.out) };
  };
  return { work, calls, caps };
}

test('R-15: 3 failed CI runs after restartedAt are reached, and the run list call names the branch', () => {
  const { calls, caps } = capsFixture({
    runs: [run('failure', 1), run('failure', 2), run('timed_out', 3), run('success', 4)],
  });
  const result = caps();
  assert.equal(result.code, 3);
  assert.deepEqual(
    { ...result.json, reason: undefined },
    { failedCi: 3, activeMinutes: 0, reached: true, reason: undefined },
  );
  assert.match(result.json.reason, /3 failed CI runs/);
  assert.match(result.errors, /^hard stop: .*3 failed CI runs/);
  const [{ args }] = calls.filter(({ args: list }) => list[0] === 'run');
  assert.deepEqual(args.slice(0, 4), ['run', 'list', '--branch', 'feat/7-x']);
  assert.ok(args.join(' ').includes('--json conclusion,createdAt'));
});

test('R-15: a cancelled run is not a failed run, and 2 failures are below the cap', () => {
  const { caps } = capsFixture({
    runs: [
      run('failure', 1),
      run('cancelled', 2),
      run('cancelled', 3),
      run('failure', 4),
      run('', 5),
    ],
  });
  const result = caps();
  assert.equal(result.code, 0, result.errors);
  assert.deepEqual(result.json, { failedCi: 2, activeMinutes: 0, reached: false, reason: null });
});

test('R-15: failed runs from before restartedAt do not count, so the counts start from 0', () => {
  const { caps } = capsFixture({
    runs: [run('failure', 1), run('failure', 2), run('failure', 3), run('failure', 30)],
    lines: [
      logLine(T0),
      logLine(T0 + 10 * MINUTE),
      logLine(T0 + 20 * MINUTE),
      logLine(T0 + 40 * MINUTE),
    ],
    ticket: { restartedAt: iso(T0 + 25 * MINUTE), resumes: 1 },
  });
  const result = caps();
  assert.equal(result.code, 0, result.errors);
  assert.deepEqual(result.json, { failedCi: 1, activeMinutes: 0, reached: false, reason: null });
});

test('R-15: active time sums the gaps, each gap capped at 10 minutes', () => {
  const { caps } = capsFixture({
    lines: [
      logLine(T0),
      logLine(T0 + 4 * MINUTE),
      logLine(T0 + 4 * MINUTE + 90 * MINUTE),
      logLine(T0 + 100 * MINUTE),
    ],
  });
  const result = caps();
  assert.equal(result.code, 0, result.errors);
  assert.equal(result.json.activeMinutes, 4 + 10 + 6);
});

test('R-15: gaps above 10 minutes are capped at 10, and a gap of exactly 3 minutes counts as 3', () => {
  const { caps } = capsFixture({
    lines: [logLine(T0), logLine(T0 + 3 * MINUTE), logLine(T0 + 60 * MINUTE)],
  });
  assert.equal(caps().json.activeMinutes, 13);
});

test('R-15: CI wait time is left out: the gap after a wait start line does not count', () => {
  const { caps } = capsFixture({
    lines: [
      logLine(T0),
      logLine(T0 + 2 * MINUTE, 'wait', 'start'),
      logLine(T0 + 62 * MINUTE, 'wait', 'end'),
      logLine(T0 + 65 * MINUTE),
    ],
  });
  assert.equal(caps().json.activeMinutes, 5);
});

test('R-15: only lines of the ticket count, from every run log file, and 3 hours is reached', () => {
  const lines = Array.from({ length: 19 }, (_, index) => logLine(T0 + index * 10 * MINUTE));
  const { work, caps } = capsFixture({ lines: lines.slice(0, 10) });
  seedLog(work, [...lines.slice(10), lineOf(8, T0 + 500 * MINUTE)], 'run-2');
  const result = caps();
  assert.equal(result.json.activeMinutes, 180);
  assert.equal(result.json.reached, true);
  assert.equal(result.code, 3);
  assert.match(result.json.reason, /active time 180 minutes/);
});

test('R-15: 179 active minutes are below the cap', () => {
  const lines = Array.from({ length: 18 }, (_, index) => logLine(T0 + index * 10 * MINUTE));
  const { caps } = capsFixture({ lines: [...lines, logLine(T0 + 170 * MINUTE + 9 * MINUTE)] });
  const result = caps();
  assert.equal(result.json.activeMinutes, 179);
  assert.equal(result.json.reached, false);
  assert.equal(result.code, 0);
});

test('R-15: lines at or before restartedAt give no gap, and a log with no line after it is 0 minutes', () => {
  const { caps } = capsFixture({
    lines: [logLine(T0), logLine(T0 + 9 * MINUTE), logLine(T0 + 20 * MINUTE)],
    ticket: { restartedAt: iso(T0 + 9 * MINUTE) },
  });
  assert.equal(caps().json.activeMinutes, 0);
});

test('R-16: a gh failure gives reached, names the count, and still prints the other count', () => {
  const { caps } = capsFixture({
    lines: [logLine(T0), logLine(T0 + 5 * MINUTE)],
    replies: {
      'run list': () => {
        throw new HardStopError('gh run list failed twice: network');
      },
    },
  });
  const result = caps();
  assert.equal(result.code, 3);
  assert.deepEqual(
    { ...result.json, reason: undefined },
    { failedCi: null, activeMinutes: 5, reached: true, reason: undefined },
  );
  assert.match(result.json.reason, /cannot derive failed CI runs: .*network/);
});

test('R-16: gh output that is not a JSON list gives reached', () => {
  for (const reply of ['not json', '{"a":1}', '[{"conclusion":"failure","createdAt":"junk"}]']) {
    const { caps } = capsFixture({ replies: { 'run list': reply } });
    const result = caps();
    assert.equal(result.json.reached, true, reply);
    assert.equal(result.json.failedCi, null, reply);
    assert.equal(result.code, 3, reply);
  }
});

test('R-16: a missing run log gives reached, and the failed CI count is still printed', () => {
  const { caps } = capsFixture({ lines: null, runs: [run('failure', 1)] });
  const result = caps();
  assert.equal(result.code, 3);
  assert.equal(result.json.failedCi, 1);
  assert.equal(result.json.activeMinutes, null);
  assert.equal(result.json.reached, true);
  assert.match(result.json.reason, /cannot derive active time: run log missing/);
});

test('R-16: a bad JSON line, a bad ts, or an unreadable ticket gives reached', () => {
  const bad = [
    [logLine(T0), '{not json', logLine(T0 + MINUTE)],
    [logLine(T0), JSON.stringify({ ts: 'yesterday', ticket: 7, event: 'stage' })],
  ];
  for (const lines of bad) {
    const { caps } = capsFixture({ lines });
    const result = caps();
    assert.equal(result.json.reached, true, lines.join('|'));
    assert.equal(result.json.activeMinutes, null);
  }
  const { work, caps } = capsFixture();
  writeAtomic(stateFile(work, '7', 'ticket.json'), '{broken');
  const result = caps();
  assert.equal(result.code, 3);
  assert.equal(result.json.reached, true);
  assert.equal(result.json.failedCi, null);
  assert.equal(result.json.activeMinutes, null);
});

test('R-16: a ticket with no state, or no branch, gives reached', () => {
  const { work, caps } = capsFixture();
  rmSync(stateFile(work, '7', 'ticket.json'));
  assert.equal(caps().json.reached, true);
  seedTicket(work, { branch: null });
  const result = caps();
  assert.equal(result.json.reached, true);
  assert.equal(result.json.failedCi, null);
});

// R-51

// GitHub names this field in snake case. A computed key keeps the naming rule quiet.
const CREATED = 'created_at';
const EVENTS = 'api repos/{owner}/{repo}/issues/7/events';
const labeled = (name, ms) => ({ event: 'labeled', label: { name }, [CREATED]: iso(ms) });

test('R-51: a new agent:ready after needs-human sets restartedAt to the event time, adds 1 to resumes', () => {
  const events = [
    labeled('agent:ready', T0 - 60 * MINUTE),
    labeled('needs-human', T0 + 100 * MINUTE),
    labeled('agent:ready', T0 + 200 * MINUTE),
    labeled('agent:ready', T0 + 300 * MINUTE),
    { event: 'unlabeled', label: { name: 'needs-human' }, [CREATED]: iso(T0 + 400 * MINUTE) },
  ];
  const { work, calls, caps } = capsFixture({
    runs: [run('failure', 1), run('failure', 2), run('failure', 3)],
    lines: [logLine(T0), logLine(T0 + 10 * MINUTE), logLine(T0 + 20 * MINUTE)],
    ticket: { stage: 'needs-human', resumes: 1 },
    replies: { [EVENTS]: JSON.stringify([events]) },
  });
  const result = caps();
  assert.equal(result.code, 0, result.errors);
  assert.deepEqual(result.json, { failedCi: 0, activeMinutes: 0, reached: false, reason: null });
  const state = readTicket(work);
  assert.equal(state.restartedAt, iso(T0 + 300 * MINUTE));
  assert.equal(state.resumes, 2);
  const [api] = calls.filter(({ args }) => args[0] === 'api');
  assert.equal(api.args[1], 'repos/{owner}/{repo}/issues/7/events');
  assert.ok(api.args.includes('--paginate'));
  // A second call with the same events does not add to resumes again.
  caps();
  assert.equal(readTicket(work).resumes, 2);
  assert.equal(readTicket(work).restartedAt, iso(T0 + 300 * MINUTE));
});

test('R-51: an agent:ready from before needs-human is not a restart', () => {
  const events = [labeled('agent:ready', T0), labeled('needs-human', T0 + 100 * MINUTE)];
  const { work, caps } = capsFixture({
    ticket: { stage: 'needs-human' },
    replies: { [EVENTS]: JSON.stringify([events]) },
  });
  const result = caps();
  assert.equal(result.code, 0, result.errors);
  assert.equal(result.json.reached, false);
  assert.equal(readTicket(work).restartedAt, null);
  assert.equal(readTicket(work).resumes, 0);
});

test('R-51: with no needs-human event on GitHub, nothing restarts', () => {
  const { work, caps } = capsFixture({
    ticket: { stage: 'needs-human' },
    replies: { [EVENTS]: JSON.stringify([[labeled('agent:ready', T0)]]) },
  });
  const result = caps();
  assert.equal(result.code, 0, result.errors);
  assert.equal(result.json.reached, false);
  assert.equal(readTicket(work).restartedAt, null);
  assert.equal(readTicket(work).resumes, 0);
});

test('R-51: a ticket that is not in stage needs-human makes no events call and keeps its fields', () => {
  const { work, calls, caps } = capsFixture({ ticket: { stage: 'building', resumes: 3 } });
  const result = caps();
  assert.equal(result.code, 0, result.errors);
  assert.equal(result.json.reached, false);
  assert.equal(calls.filter(({ args }) => args[0] === 'api').length, 0);
  assert.equal(readTicket(work).resumes, 3);
  assert.equal(readTicket(work).restartedAt, null);
});

test('R-51: an events call that fails gives reached, and ticket.json is unchanged', () => {
  const { work, caps } = capsFixture({
    ticket: { stage: 'needs-human' },
    replies: {
      [EVENTS]: () => {
        throw new HardStopError('gh api failed twice: network');
      },
    },
  });
  const result = caps();
  assert.equal(result.code, 3);
  assert.equal(result.json.reached, true);
  assert.match(result.json.reason, /cannot derive restart: .*network/);
  assert.equal(readTicket(work).resumes, 0);
});
