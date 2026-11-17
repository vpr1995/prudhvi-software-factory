// Tests for `comment`, `hardstop` and `caps` of scripts/factory.mjs (design factory-daily-run 4.1,
// R-8, R-12, R-15, R-16, R-51, R-55). `gh` is a stub that records each call and the --body-file
// text at call time. Git is real: temp repos with a local bare remote. No test calls the real gh
// or the network.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { main, run as runProcess } from '../scripts/factory.mjs';
import { buildComment, MARKER, redactText } from '../scripts/lib/factory-comment.mjs';
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

/** The template: a work repo on feat/7-x (one commit ahead of main) with a bare remote that holds main. */
function buildTemplate() {
  const folder = temporaryFolder();
  const remote = path.join(folder, 'remote.git');
  const work = path.join(folder, 'work');
  git(folder, 'init', '-q', '--bare', '-b', 'main', remote);
  git(folder, 'init', '-q', '-b', 'main', work);
  git(work, 'config', 'commit.gpgsign', 'false');
  git(work, 'config', 'core.hooksPath', '/dev/null');
  // Set an identity in the repo: factory.mjs runs git merge with the process environment, and a CI runner has no identity.
  git(work, 'config', 'user.name', 't');
  git(work, 'config', 'user.email', 't@t');
  git(work, 'remote', 'add', 'origin', remote);
  commitFile(work, 'README.md', 'hello\n');
  commitFile(work, 'src/a.js', 'export const a = 0;\n');
  git(work, 'push', '-q', 'origin', 'main');
  git(work, 'checkout', '-q', '-b', 'feat/7-x');
  commitFile(work, 'src/b.js', 'export const b = 1;\n');
  return folder;
}

let template;

/** A copy of the template (built once). The copy has its own bare remote: origin points at it. */
function makeRepository() {
  template ??= buildTemplate();
  const folder = temporaryFolder();
  cpSync(template, folder, { recursive: true });
  const remote = path.join(folder, 'remote.git');
  const work = path.join(folder, 'work');
  git(work, 'remote', 'set-url', 'origin', remote);
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
    // Step 5 of the hard stop (metrics): no comment yet, no CI run.
    'api repos/{owner}/{repo}/issues/7/comments': '[[]]',
    'api repos/{owner}/{repo}/issues/12/comments': '[[]]',
    'run list': '[]',
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
const isMetrics = ({ body }) => body?.includes('```factory-metrics') === true;
// The hard-stop and reply comments. The metrics comment of hard-stop step 5 has its own helper.
const comments = (calls) => calls.filter((call) => call.args[1] === 'comment' && !isMetrics(call));
const metricsComments = (calls) =>
  calls.filter((call) => call.args[1] === 'comment' && isMetrics(call));

/** Runs one factory command in process. Returns the exit code and the text of stdout and stderr. */
function runFactory(argv, overrides) {
  const out = [];
  const errors = [];
  const code = main(['node', 'factory.mjs', ...argv], {
    stdin: () => '',
    now: () => new Date('2026-11-17T10:00:00Z'),
    claudeVersion: () => '2.1.300 (Claude Code)\n',
    transcriptRoot: () => path.join(tmpdir(), 'factory-caps-no-transcripts'),
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

const HARD_STOP = 'hard-stop';

test('R-8: comment hard-stop posts the body from stdin through a body file, first line is the marker', () => {
  const work = temporaryFolder();
  const { gh, calls } = makeGh();
  const body = 'Plain `code` and ```fence``` with $(rm -rf /) and "quotes"\nsecond line';
  const result = runFactory(['comment', '7', HARD_STOP], { root: work, gh, stdin: () => body });
  assert.equal(result.code, 0, result.errors);
  assert.equal(calls.length, 1);
  const [{ args, body: posted }] = calls;
  assert.deepEqual(args.slice(0, 4), ['issue', 'comment', '7', '--body-file']);
  assert.ok(posted.startsWith(`${MARKER}\n`), posted);
  assert.ok(posted.includes(body));
  for (const argument of args) assert.ok(!argument.includes('code'), 'body must not be in argv');
});

test('R-8: comment hard-stop posts on the issue, also when the ticket has a PR', () => {
  const work = temporaryFolder();
  seedTicket(work, { pr: 12 });
  const { gh, calls } = makeGh();
  const result = runFactory(['comment', '7', HARD_STOP], { root: work, gh, stdin: () => 'stop' });
  assert.equal(result.code, 0, result.errors);
  assert.deepEqual(calls[0].args.slice(0, 4), ['issue', 'comment', '7', '--body-file']);
});

test('R-8: comment reply posts on the PR of ticket.json, and a body with the marker gets no second one', () => {
  const work = temporaryFolder();
  seedTicket(work, { pr: 12 });
  const { gh, calls } = makeGh();
  const result = runFactory(['comment', '7', 'reply'], {
    root: work,
    gh,
    stdin: () => `${MARKER}\nalready marked`,
  });
  assert.equal(result.code, 0, result.errors);
  assert.deepEqual(calls[0].args.slice(0, 4), ['pr', 'comment', '12', '--body-file']);
  assert.equal(calls[0].body, `${MARKER}\nalready marked`);
  assert.match(result.out, /PR #12/);
});

test('R-8: comment reply posts on the issue when ticket.json has no pr, or no ticket state exists', () => {
  const work = temporaryFolder();
  const missing = makeGh();
  assert.equal(
    runFactory(['comment', '7', 'reply'], { root: work, gh: missing.gh, stdin: () => 'a' }).code,
    0,
  );
  assert.deepEqual(missing.calls[0].args.slice(0, 3), ['issue', 'comment', '7']);
  seedTicket(work, { pr: null });
  const empty = makeGh();
  assert.equal(
    runFactory(['comment', '7', 'reply'], { root: work, gh: empty.gh, stdin: () => 'a' }).code,
    0,
  );
  assert.deepEqual(empty.calls[0].args.slice(0, 3), ['issue', 'comment', '7']);
});

test('R-8: comment hard-stop still posts when ticket.json is broken', () => {
  const work = temporaryFolder();
  writeAtomic(stateFile(work, '7', 'ticket.json'), '{broken');
  const { gh, calls } = makeGh();
  const result = runFactory(['comment', '7', HARD_STOP], { root: work, gh, stdin: () => 'stop' });
  assert.equal(result.code, 0, result.errors);
  assert.deepEqual(calls[0].args.slice(0, 3), ['issue', 'comment', '7']);
});

test('R-8: comment refuses an empty body, an unknown kind, and a bad argument, and calls no gh', () => {
  const work = temporaryFolder();
  seedTicket(work);
  const { gh, calls } = makeGh();
  const empty = runFactory(['comment', '7', HARD_STOP], { root: work, gh });
  assert.equal(empty.code, 2);
  assert.match(empty.errors, /comment body is empty/);
  const usage = /Usage: comment <n> <hard-stop\|reply> \[<reply-to-id>\]/;
  const cases = [
    [[], usage],
    [['--pr', '12'], /unknown kind "--pr"/],
    [['--pr'], /unknown kind "--pr"/],
    [['note'], /unknown kind "note"/],
    [['Reply'], /unknown kind "Reply"/],
    [['reply', 'x'], usage],
    [['reply', '0'], usage],
    [['reply', '-5'], usage],
    [['reply', '1', '2'], usage],
    [[HARD_STOP, '55'], usage],
  ];
  for (const [flags, message] of cases) {
    const bad = runFactory(['comment', '7', ...flags], { root: work, gh, stdin: () => 'a' });
    assert.equal(bad.code, 2, flags.join(' '));
    assert.match(bad.errors, message, flags.join(' '));
  }
  assert.equal(calls.length, 0);
});

test('R-8: comment reply with an id stores it in handledComments once, and keeps the other keys', () => {
  const work = temporaryFolder();
  seedTicket(work, { pr: 12, handledComments: [55], threadReplies: { 9: 1 } });
  const first = makeGh();
  const post = (id, gh) =>
    runFactory(['comment', '7', 'reply', id], { root: work, gh, stdin: () => 'fixed' });
  assert.equal(post('56', first.gh).code, 0);
  assert.deepEqual(readTicket(work).handledComments, [55, 56]);
  assert.equal(post('56', first.gh).code, 0);
  assert.equal(post('55', first.gh).code, 0);
  assert.deepEqual(readTicket(work).handledComments, [55, 56], 'no duplicate');
  assert.equal(first.calls.length, 3, 'each reply is posted');
  const state = readTicket(work);
  assert.equal(state.pr, 12);
  assert.deepEqual(state.threadReplies, { 9: 1 });
});

test('R-8: comment reply with an id and no handledComments key creates the list', () => {
  const work = temporaryFolder();
  seedTicket(work);
  const { gh } = makeGh();
  assert.equal(
    runFactory(['comment', '7', 'reply', '70'], { root: work, gh, stdin: () => 'x' }).code,
    0,
  );
  assert.deepEqual(readTicket(work).handledComments, [70]);
});

test('R-8: comment reply with no id stores nothing, and a failed post stores nothing', () => {
  const work = temporaryFolder();
  seedTicket(work, { handledComments: [1] });
  const plain = makeGh();
  assert.equal(
    runFactory(['comment', '7', 'reply'], { root: work, gh: plain.gh, stdin: () => 'x' }).code,
    0,
  );
  assert.deepEqual(readTicket(work).handledComments, [1]);
  const failing = makeGh({
    'issue comment': () => {
      throw new HardStopError('gh issue comment failed twice: network');
    },
  });
  const result = runFactory(['comment', '7', 'reply', '2'], {
    root: work,
    gh: failing.gh,
    stdin: () => 'x',
  });
  assert.equal(result.code, 3);
  assert.deepEqual(readTicket(work).handledComments, [1]);
});

test('R-8: comment reply with an id and no ticket state is refused before it posts', () => {
  const work = temporaryFolder();
  const { gh, calls } = makeGh();
  const result = runFactory(['comment', '7', 'reply', '70'], { root: work, gh, stdin: () => 'x' });
  assert.equal(result.code, 2);
  assert.match(result.errors, /no ticket state/);
  assert.equal(calls.length, 0);
});

test('R-8: comment redacts and caps the body at 60,000 characters, marker included', () => {
  const work = temporaryFolder();
  const { gh, calls } = makeGh();
  const body = `token=abc123\n${'x'.repeat(70_000)}`;
  assert.equal(
    runFactory(['comment', '7', HARD_STOP], { root: work, gh, stdin: () => body }).code,
    0,
  );
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

const MEGABYTE = 1024 * 1024;
const TIME_LIMIT_MS = 1000;

/** Asserts that redactText finishes in under a second on the text, and returns its output. */
function timedRedactText(text) {
  const start = performance.now();
  const output = redactText(text);
  const elapsed = performance.now() - start;
  assert.ok(
    elapsed < TIME_LIMIT_MS,
    `redactText took ${Math.round(elapsed)} ms on ${text.length} bytes`,
  );
  return output;
}

test('redaction: each pattern is linear on 1 MB of text that fits its character class', () => {
  const units = ['a-', 'a.', 'a+', 'eyJ', 'eyJ-', 'eyJa.', 'sk-a', 'xoxb-', 'token-', 'api-key-'];
  for (const unit of units) timedRedactText(unit.repeat(Math.ceil(MEGABYTE / unit.length)));
  // Text with no secret in it must come back as it went in.
  for (const plain of [
    'a-'.repeat(MEGABYTE / 2),
    'ab-'.repeat(MEGABYTE / 3),
    'a.'.repeat(MEGABYTE / 2),
  ]) {
    assert.equal(timedRedactText(plain), plain);
  }
});

test('redaction: 1 MB of hyphens does not hide a secret that follows it', () => {
  const filler = 'a-'.repeat(MEGABYTE / 2);
  const jwt = joined('eyJhbGciOiJIUzI1NiJ9', '.payload.sig');
  const text = timedRedactText(
    `${filler}\nfetch https://user:pass@github.com/a ${jwt} password=hunter2\n${filler}`,
  );
  assert.equal(text, `${filler}\nfetch https://***@github.com/a [redacted] [redacted]\n${filler}`);
});

test('redaction: a JWT in a long text is redacted whole, whatever the segment size', () => {
  const jwt = joined('eyJhbGciOiJIUzI1NiJ9.', 'a'.repeat(20000), '.', 'b'.repeat(20000));
  assert.equal(timedRedactText(`x ${jwt} y`), 'x [redacted] y');
});

test('redaction: JSON escaped inside a string, a => separator and an escaped quote are redacted', () => {
  assert.equal(assertRedacted(String.raw`{\"token\":\"abc123\"}`, 'abc123'), '{[redacted]}');
  assert.equal(assertRedacted('password => "hunter2"', 'hunter2'), '[redacted]');
  assert.equal(assertRedacted(`secret => 'hunter2' end`, 'hunter2'), '[redacted] end');
  assert.equal(assertRedacted('{"password": "a\\"b c"}', 'b c', 'a\\"'), '{[redacted]}');
  assert.equal(
    assertRedacted(String.raw`{\"password\": \"x y\", \"user\": 1}`, 'x y'),
    String.raw`{[redacted], \"user\": 1}`,
  );
});

// Secret-like test values are built from parts, so the secret scanner of the pre-commit hook does not flag this file.
const joined = (...parts) => parts.join('');

/** Asserts that the text has [redacted] and no part of the secret. */
function assertRedacted(input, ...secrets) {
  const text = redactText(input);
  for (const secret of secrets) assert.ok(!text.includes(secret), `${input} -> ${text}`);
  assert.match(text, /\[redacted\]/, input);
  return text;
}

test('redaction: a quoted or JSON key is redacted with its value', () => {
  assertRedacted('{"token": "abc"}', 'abc');
  assertRedacted('{"password": "x", "user": "u"}', '"x"');
  assertRedacted(`{'apiKey': 'y'}`, "'y'");
  assertRedacted('{"password":"hunter2"}', 'hunter2');
  assert.match(redactText('{"password": "x", "user": "u"}'), /"user": "u"/);
});

test('redaction: a key that holds the keyword in a longer name is redacted', () => {
  const secret = joined('wJalrXUtn', 'FEMI/K7MDENG');
  for (const key of [
    'AWS_SECRET_ACCESS_KEY=',
    'secretAccessKey: ',
    'client_secret=',
    'access_key=',
    'passwd=',
    'GITHUB_TOKEN=',
    'DB_PASSWORD: ',
  ]) {
    assertRedacted(`${key}${secret} end`, secret);
  }
});

test('redaction: a Bearer value is redacted whole', () => {
  const jwt = joined('eyJhbGciOiJIUzI1NiJ9', '.payload.sig');
  assert.equal(assertRedacted(`token: Bearer ${jwt}`, 'Bearer', jwt), '[redacted]');
  assert.equal(assertRedacted('Authorization: Bearer abc.def', 'abc.def', 'Bearer'), '[redacted]');
  assert.equal(
    assertRedacted('Authorization: Basic dXNlcjpwYXNz', 'dXNlcjpwYXNz', 'Basic'),
    '[redacted]',
  );
  assert.equal(redactText('x token: Bearer\nabc'), 'x [redacted]\nabc', 'same line only');
});

test('redaction: a quoted value with spaces is redacted whole', () => {
  assert.equal(assertRedacted('password: "a b c" end', 'b c'), '[redacted] end');
  assert.equal(assertRedacted(`secret='one two' end`, 'two'), '[redacted] end');
  assert.equal(assertRedacted('password: "a b c', '"a'), '[redacted] b c', 'no closing quote');
});

test('redaction: a bare JWT is redacted', () => {
  const jwt = joined('eyJhbGciOiJIUzI1NiJ9', '.eyJzdWIiOiIxIn0', '.c2ln-_x');
  assert.equal(assertRedacted(`header ${jwt} end`, jwt), 'header [redacted] end');
});

test('redaction: --password and --token flag values are redacted', () => {
  assert.equal(assertRedacted('run --password hunter2 now', 'hunter2'), 'run [redacted] now');
  assert.equal(assertRedacted('run --token abc now', 'abc'), 'run [redacted] now');
  assert.equal(assertRedacted('run --token "a b" now', 'a b'), 'run [redacted] now');
  assert.equal(redactText('run --token\nabc'), 'run --token\nabc', 'same line only');
  assert.equal(redactText('run --password --verbose'), 'run --password --verbose');
});

test('redaction: ASIA keys and npm, Slack and Google tokens are redacted', () => {
  const cases = [
    joined('ASIA', 'A1B2C3D4E5F6G7H8'),
    joined('AKIA', 'A1B2C3D4E5F6G7H8'),
    joined('npm_', 'a1B2'.repeat(9)),
    joined('xox', 'b-', '1234567890-abcdEFGH'),
    joined('xox', 'p-', '1234567890-abcdEFGH'),
    joined('AIza', 'Sy', 'a1B2c3D4'.repeat(5).slice(0, 33)),
  ];
  for (const secret of cases) {
    assert.equal(assertRedacted(`key ${secret} end`, secret), 'key [redacted] end');
  }
  assert.equal(
    redactText('npm_short and xoxb-short and ASIA123'),
    'npm_short and xoxb-short and ASIA123',
  );
});

test('redaction: /root and C:\\Users\\<name> become ~, and /rooted and a/root/b stay', () => {
  assert.equal(redactText('at /root/code/a.js:1'), 'at ~/code/a.js:1');
  assert.equal(redactText('HOME=/root'), 'HOME=~');
  assert.equal(redactText('at C:\\Users\\bob\\code\\a.js'), 'at ~\\code\\a.js');
  assert.equal(redactText('at c:/Users/bob/x'), 'at ~/x');
  assert.equal(redactText('/rooted /a/root/b /var/root'), '/rooted /a/root/b /var/root');
});

test('redaction: no pattern matches across a newline, and a long text is fast', () => {
  assert.equal(redactText('password:\nvalue'), 'password:\nvalue');
  assert.equal(redactText('"token":\n"x"'), '"token":\n"x"');
  assert.equal(redactText('secret=\nnext'), 'secret=\nnext');
  const started = Date.now();
  redactText(`${'x'.repeat(200_000)}\n${'_token'.repeat(20_000)}`);
  assert.ok(Date.now() - started < 2000, 'redaction must not be quadratic');
});

// mentions (R-8)

const ZWSP = '\u200B';

test('R-8: an @name outside code gets a zero-width space, so nobody is pinged', () => {
  const posted = buildComment('hi @alice and (@bob), mail a@b.com, @ alone, @_x, @');
  assert.equal(
    posted,
    `${MARKER}\nhi @${ZWSP}alice and (@${ZWSP}bob), mail a@${ZWSP}b.com, @ alone, @_x, @`,
  );
});

test('R-8: an @name in a code fence or in inline code stays as it is', () => {
  // A closer needs the same character and at least the length of the opener.
  const body = [
    'out @a',
    '````',
    'in fence @b',
    '```',
    '~~~~~',
    'still in @c',
    '````',
    'after @d',
    '~~~js',
    'tilde @e',
    '```',
    '~~~',
    'end @g `inline @h` and ``two ` @i`` @j',
  ].join('\n');
  const lines = buildComment(body).split('\n');
  assert.deepEqual(lines.slice(1), [
    `out @${ZWSP}a`,
    '````',
    'in fence @b',
    '```',
    '~~~~~',
    'still in @c',
    '````',
    `after @${ZWSP}d`,
    '~~~js',
    'tilde @e',
    '```',
    '~~~',
    `end @${ZWSP}g \`inline @h\` and \`\`two \` @i\`\` @${ZWSP}j`,
  ]);
});

test('R-8: a one-line triple backtick span is inline code, not a fence, and an open fence runs on', () => {
  const lines = buildComment('```x @a``` then @b\nnext @c').split('\n');
  assert.equal(lines[1], `\`\`\`x @a\`\`\` then @${ZWSP}b`);
  assert.equal(lines[2], `next @${ZWSP}c`);
  assert.equal(
    buildComment('```\nopen @a\nmore @b').split('\n').slice(1).join('|'),
    '```|open @a|more @b',
  );
});

test('R-8: an unclosed backtick run is literal, so a later lone backtick makes no fake code span', () => {
  for (const body of ['``a @bob ` x', 'x `` @bob ` y', '`` @bob `', '``` @bob `` y']) {
    const posted = buildComment(body);
    assert.ok(posted.includes(`@${ZWSP}bob`), `${body} -> ${posted}`);
  }
  // A closer of the same length still makes code.
  assert.equal(buildComment('`` @bob ``').split('\n')[1], '`` @bob ``');
  assert.equal(buildComment('x ` @bob ``` @cy ` z').split('\n')[1], `x \` @bob \`\`\` @cy \` z`);
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
const EXCERPT_END = '-excerpt.txt';
const excerpts = (work) =>
  listFolder(logsFolder(work)).filter((name) => name.endsWith(EXCERPT_END));
const excerptText = (work) => readFileSync(path.join(logsFolder(work), excerpts(work)[0]), 'utf8');

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
      'issue comment': (args) => {
        // The metrics comment of step 5 is also an issue comment: this probe is for the hard-stop comment.
        const text = readFileSync(args[args.indexOf('--body-file') + 1], 'utf8');
        if (text.includes('```factory-metrics')) return '';
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
  assert.match(result.out, /step 5 metrics: created on the issue/);
  assert.match(result.out, /step 6 report: wrote \.claude\/factory\/runs\/adhoc-report\.md/);
  assert.match(result.out, /step 7 clear: no active run/);
  const report = readFileSync(stateFile(work, 'runs', 'adhoc-report.md'), 'utf8');
  assert.match(report, new RegExp(`## Ticket that stopped\\n+- #7: ${REASON}`));
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
  assert.equal(detail.length, 7, 'steps 1 to 7');
  assert.match(detail[4], /^step 5 metrics: created on the issue/);
  assert.match(detail[5], /^step 6 report: wrote /);
  assert.equal(detail[6], 'step 7 clear: no active run');
  assert.equal(events.filter((entry) => entry.event === 'skip').length, 0, 'no step is skipped');
});

const METRICS_BLOCK = /```factory-metrics\n([^\n]*)\n```/;

test('R-12 step 5: the hard stop posts the metrics comment with the outcome needs-human, on the PR when there is one', () => {
  const { work } = makeRepository();
  seedTicket(work, { pr: 12 });
  seedLog(work, [logLine(T0)]);
  const { calls, overrides } = hardstopOverrides(work);
  const result = runFactory(['hardstop', '7', REASON], overrides);
  assert.equal(result.code, 0, result.errors);
  assert.match(result.out, /step 5 metrics: created on PR #12/);
  assert.equal(metricsComments(calls).length, 1);
  const [metrics] = metricsComments(calls);
  assert.deepEqual(metrics.args.slice(0, 3), ['pr', 'comment', '12']);
  assert.ok(metrics.body.startsWith(`${MARKER}\n`));
  const parsed = JSON.parse(METRICS_BLOCK.exec(metrics.body)[1]);
  assert.equal(parsed.v, 2);
  assert.equal(parsed.outcome, 'needs-human');
  assert.equal(parsed.issue, 7);
  assert.equal(parsed.pr, 12);
  // The reason text stays in the hard-stop comment: the metrics comment has numbers and names only.
  assert.ok(!metrics.body.includes(REASON));
});

test('R-12 step 5: a second hard stop edits the metrics comment, it does not post a second one', () => {
  const { work } = makeRepository();
  seedTicket(work, { pr: 12 });
  seedLog(work, [logLine(T0)]);
  const stored = [];
  const replies = {
    'api repos/{owner}/{repo}/issues/12/comments': () => JSON.stringify([stored]),
    'pr comment': (args) => {
      stored.push({ id: 900, body: readFileSync(args[args.indexOf('--body-file') + 1], 'utf8') });
      return '';
    },
  };
  const first = hardstopOverrides(work, { replies });
  assert.equal(runFactory(['hardstop', '7', REASON], first.overrides).code, 0);
  const second = hardstopOverrides(work, { replies });
  assert.equal(runFactory(['hardstop', '7', REASON], second.overrides).code, 0);
  assert.equal(stored.length, 1);
  const edit = second.calls.find(({ args }) => args.includes('PATCH'));
  assert.equal(edit.args[1], 'repos/{owner}/{repo}/issues/comments/900');
  assert.equal(metricsComments(second.calls).length, 0, 'no second post');
});

test('R-12: the posted comment has the marker, reason, branch, patch name and excerpt file name, and no excerpt line', () => {
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
  const [file] = excerpts(work);
  assert.match(file, /^hardstop-\d{8}T\d{6}Z-excerpt\.txt$/);
  assert.ok(body.includes(`Error excerpt: ${file} (in the ticket logs of the agent machine)`));
  for (const line of ['failure at', 'a.js', 'hunter2', 'last line', '/Users/bob']) {
    assert.ok(!body.includes(line), `${line} must not be in the comment`);
  }
  // The excerpt file is redacted (second layer) and holds each line.
  assert.equal(excerptText(work), 'failure at ~/code/a.js\n[redacted]\nlast line\n');
  assert.equal(file.slice(0, -EXCERPT_END.length), patches(work)[0].replace(/\.patch$/, ''));
});

test('R-12: the excerpt file keeps the last 40 lines, and the comment holds none of them', () => {
  const { work } = makeRepository();
  seedTicket(work);
  seedLog(work, [logLine(T0)]);
  const excerpt = Array.from({ length: 100 }, (_, index) => `row ${String(index + 1)}`).join('\n');
  const { calls, overrides } = hardstopOverrides(work, { overrides: { stdin: () => excerpt } });
  assert.equal(runFactory(['hardstop', '7', REASON], overrides).code, 0);
  const [{ body }] = comments(calls);
  assert.ok(!/^row \d+$/m.test(body), 'no excerpt line in the comment');
  assert.equal(excerpts(work).length, 1);
  const rows = excerptText(work).trimEnd().split('\n');
  assert.equal(rows.length, 40);
  assert.equal(rows[0], 'row 61');
  assert.equal(rows.at(-1), 'row 100');
});

test('R-12: the excerpt file has mode 0600', () => {
  const { work } = makeRepository();
  seedTicket(work);
  seedLog(work, [logLine(T0)]);
  const { overrides } = hardstopOverrides(work, { overrides: { stdin: () => 'boom' } });
  const previous = process.umask(0o022);
  try {
    assert.equal(runFactory(['hardstop', '7', REASON], overrides).code, 0);
  } finally {
    process.umask(previous);
  }
  assert.equal(statSync(path.join(logsFolder(work), excerpts(work)[0])).mode & 0o777, 0o600);
});

test('R-12: an empty stdin saves no excerpt file, and the comment says none', () => {
  const { work } = makeRepository();
  seedTicket(work);
  seedLog(work, [logLine(T0)]);
  const { calls, overrides } = hardstopOverrides(work, { overrides: { stdin: () => '\n  \n' } });
  assert.equal(runFactory(['hardstop', '7', REASON], overrides).code, 0);
  assert.deepEqual(excerpts(work), []);
  assert.match(comments(calls)[0].body, /^Error excerpt: none$/m);
});

test('R-12: a secret form the redaction misses stays out of each gh call and body file', () => {
  const { work } = makeRepository();
  seedTicket(work);
  seedLog(work, [logLine(T0)]);
  dirty(work);
  const secret = String.raw`{\"token\":\"ab\\\"cd\"}`;
  assert.equal(redactText(secret), secret, 'the redaction misses this form');
  const { calls, overrides } = hardstopOverrides(work, { overrides: { stdin: () => secret } });
  assert.equal(runFactory(['hardstop', '7', REASON], overrides).code, 0);
  assert.ok(calls.length > 0);
  const pieces = [secret, String.raw`ab\"cd`, String.raw`\"token\"`];
  for (const { args, body } of calls) {
    const seen = `${args.join('\n')}\n${body ?? ''}`;
    for (const piece of pieces) assert.ok(!seen.includes(piece), `${piece} in ${args.join(' ')}`);
  }
  assert.equal(excerptText(work), `${secret}\n`);
});

test('R-12: a reason that ends in token: cannot swallow the closing fence', () => {
  const { work } = makeRepository();
  seedTicket(work);
  seedLog(work, [logLine(T0)]);
  const excerpt = 'cannot find module\n@vprprudhvi/tooling-repo-checks';
  const { calls, overrides } = hardstopOverrides(work, { overrides: { stdin: () => excerpt } });
  assert.equal(runFactory(['hardstop', '7', 'bad token:'], overrides).code, 0);
  const lines = comments(calls)[0].body.split('\n');
  assert.ok(!lines.some((line) => line.includes('@vprprudhvi')), 'no excerpt line in the comment');
  const fences = lines
    .map((line, index) => (line === '```' ? index : -1))
    .filter((position) => position >= 0);
  assert.equal(fences.length, 2, 'the reason fence pair only');
  assert.ok(lines.indexOf('Branch: `feat/7-x`') > fences[1], 'text after the reason stays');
});

test('R-12: a private key that starts early in a long excerpt is gone from the excerpt file, also the lines after the cut', () => {
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
  const saved = excerptText(work);
  assert.ok(!saved.includes('KEYBODY'), 'no key line in the excerpt file');
  assert.ok(saved.includes('[redacted]'));
  const unterminated = hardstopOverrides(work);
  assert.equal(runFactory(['hardstop', '7', `x ${header}`], unterminated.overrides).code, 0);
  assert.match(
    comments(unterminated.calls)[0].body,
    /Branch: `feat\/7-x`/,
    'text after the reason stays',
  );
});

test('R-12: a fence in the reason cannot close the code block, and @names sit inside the fence', () => {
  const { work } = makeRepository();
  seedTicket(work);
  seedLog(work, [logLine(T0)]);
  const reason = '```\n@vprprudhvi/tooling-repo-checks failed\n````';
  const { calls, overrides } = hardstopOverrides(work, { overrides: { stdin: () => 'boom' } });
  assert.equal(runFactory(['hardstop', '7', reason], overrides).code, 0);
  const [{ body }] = comments(calls);
  const lines = body.split('\n');
  const fence = lines.find((line) => /^`{5,}$/.test(line));
  assert.ok(fence !== undefined, 'fence longer than any backtick run in the reason');
  const open = lines.indexOf(fence);
  const close = lines.lastIndexOf(fence);
  const mention = lines.findIndex((line) => line.includes('@vprprudhvi/tooling-repo-checks'));
  assert.ok(open < mention && mention < close);
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

const MIB = 1024 * 1024;

test('R-12: an untracked file above 1 MiB is not in the patch, and the step line names it', () => {
  const { work } = makeRepository();
  seedTicket(work);
  seedLog(work, [logLine(T0)]);
  dirty(work);
  writeFileSync(path.join(work, 'big.bin'), 'x'.repeat(MIB + 1));
  writeFileSync(path.join(work, 'huge.bin'), 'y'.repeat(2 * MIB));
  writeFileSync(path.join(work, 'exact.bin'), 'z'.repeat(MIB));
  const { overrides } = hardstopOverrides(work);
  const result = runFactory(['hardstop', '7', REASON], overrides);
  assert.equal(result.code, 0, result.errors);
  const text = readFileSync(path.join(logsFolder(work), patches(work)[0]), 'utf8');
  assert.ok(text.includes('untracked note'), 'small untracked file stays');
  assert.ok(text.includes('diff --git a/exact.bin'), 'a file of exactly 1 MiB stays');
  assert.ok(!text.includes('big.bin') && !text.includes('huge.bin'), 'big files are skipped');
  const [line] = result.out.split('\n').filter((row) => row.startsWith('step 3 patch:'));
  assert.match(line, /^step 3 patch: saved hardstop-\S+\.patch; skipped 2 files over 1 MiB: /);
  assert.ok(line.includes('big.bin') && line.includes('huge.bin'), line);
  assert.ok(!line.includes('exact.bin') && !line.includes('notes.txt'), line);
});

test('R-12: with only a file above 1 MiB there is no patch, and the step line still names the file', () => {
  const { work } = makeRepository();
  seedTicket(work);
  seedLog(work, [logLine(T0)]);
  writeFileSync(path.join(work, 'big.bin'), 'x'.repeat(MIB + 1));
  const { overrides } = hardstopOverrides(work);
  const result = runFactory(['hardstop', '7', REASON], overrides);
  assert.equal(result.code, 0, result.errors);
  assert.deepEqual(patches(work), []);
  assert.match(result.out, /step 3 patch: nothing to save; skipped 1 file over 1 MiB: big\.bin/);
});

test('R-12: the patch file has mode 0600', () => {
  const { work } = makeRepository();
  seedTicket(work);
  seedLog(work, [logLine(T0)]);
  dirty(work);
  const { overrides } = hardstopOverrides(work);
  const previous = process.umask(0o022);
  try {
    assert.equal(runFactory(['hardstop', '7', REASON], overrides).code, 0);
  } finally {
    process.umask(previous);
  }
  const [name] = patches(work);
  assert.equal(statSync(path.join(logsFolder(work), name)).mode & 0o777, 0o600);
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

test('R-12: a second run changes nothing: no gh write, no second patch, no second excerpt, same files', () => {
  const { remote, work } = makeRepository();
  seedTicket(work);
  seedLog(work, [logLine(T0)]);
  dirty(work);
  const stdin = () => 'boom\nfailed at step 2';
  // A stateful comment list: step 5 finds its own comment from the first run and edits it.
  const stored = [];
  const replies = {
    'api repos/{owner}/{repo}/issues/7/comments': () => JSON.stringify([stored]),
    'issue comment': (args) => {
      const body = readFileSync(args[args.indexOf('--body-file') + 1], 'utf8');
      if (body.includes('```factory-metrics')) stored.push({ id: 901, body });
      return '';
    },
  };
  const first = hardstopOverrides(work, { replies, overrides: { stdin } });
  assert.equal(runFactory(['hardstop', '7', REASON], first.overrides).code, 0);
  assert.equal(comments(first.calls).length, 1);
  const before = {
    ticket: readFileSync(stateFile(work, '7', 'ticket.json'), 'utf8'),
    patches: patches(work),
    excerpts: excerpts(work),
    remote: git(remote, 'rev-parse', 'feat/7-x'),
    status: git(work, 'status', '--porcelain', '--untracked-files=all'),
  };
  const second = hardstopOverrides(work, { replies, overrides: { stdin } });
  const result = runFactory(['hardstop', '7', REASON], second.overrides);
  assert.equal(result.code, 0, result.errors);
  assert.deepEqual(writes(second.calls), []);
  // Step 5 reads the comments and the CI runs, and edits its own comment in place.
  const isStepFive = ({ args }) =>
    (args[0] === 'api' && args[1].includes('/comments')) ||
    (args[0] === 'run' && args[1] === 'list');
  assert.deepEqual(
    second.calls.filter((call) => !isStepFive(call)),
    [],
    'step 1 and step 4 make no gh call at all',
  );
  assert.equal(stored.length, 1, 'no second metrics comment');
  assert.equal(second.calls.filter(({ args }) => args.includes('PATCH')).length, 1);
  assert.deepEqual(patches(work), before.patches);
  assert.equal(before.excerpts.length, 1);
  assert.deepEqual(excerpts(work), before.excerpts, 'no second excerpt file');
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
  assert.match(result.out, /step 7 clear: no active run/, 'later steps still run');
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

test('R-12: a run.json that cannot be read does not stop the steps, and each log failure is printed', () => {
  const { remote, work } = makeRepository();
  seedTicket(work);
  writeAtomic(stateFile(work, 'run.json'), '{broken');
  dirty(work);
  const { calls, overrides } = hardstopOverrides(work);
  const result = runFactory(['hardstop', '7', REASON], overrides);
  assert.equal(result.code, 2);
  const order = [...result.out.matchAll(/^step (\d) (\w+):/gm)].map((match) => match[2]);
  assert.deepEqual(order, ['labels', 'push', 'patch', 'comment', 'metrics', 'report', 'clear']);
  // Steps 6 and 7 are real now: with a run.json that cannot be read they fail loudly, and the
  // other steps still run. Before task 2c they were no-ops, so no step failed.
  assert.deepEqual(
    [...result.out.matchAll(/^step (\d) \w+: FAILED/gm)].map((match) => match[1]),
    ['6', '7'],
  );
  assert.match(result.out, /step 6 report: FAILED: run\.json: not valid JSON/);
  assert.match(result.out, /step 7 clear: FAILED: run\.json: not valid JSON/);
  assert.match(result.errors, /steps failed: 6 report, 7 clear/);
  assert.match(result.out, /^log failed: run\.json: not valid JSON$/m);
  assert.equal(
    result.out.match(/^log failed:/gm).length,
    8,
    'the stage move and each of the 7 steps',
  );
  assert.equal(readTicket(work).stage, 'needs-human', 'step 1 moved the stage');
  assert.ok(calls.some(({ args }) => args[1] === 'edit' && args.includes('needs-human')));
  assert.equal(git(remote, 'rev-parse', 'feat/7-x').trim(), git(work, 'rev-parse', 'HEAD').trim());
  assert.equal(patches(work).length, 1);
  assert.equal(comments(calls).length, 1);
  assert.ok(!existsSync(stateFile(work, 'runs')), 'nothing was logged');
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

/** The remote branch added new.txt. The local branch has a new commit and an untracked new.txt. */
function makeUntrackedOverwrite() {
  const repository = makeRepository();
  const { folder, remote, work } = repository;
  git(work, 'push', '-q', 'origin', 'feat/7-x');
  const other = path.join(folder, 'other');
  git(folder, 'clone', '-q', remote, other);
  git(other, 'checkout', '-q', 'feat/7-x');
  commitFile(other, 'new.txt', 'remote\n');
  git(other, 'push', '-q', 'origin', 'feat/7-x');
  commitFile(work, 'src/c.js', 'export const c = 3;\n');
  writeFileSync(path.join(work, 'new.txt'), 'mine\n');
  return repository;
}

test('R-55: a merge that fails with no merge started is not aborted, and the reason is the failure', () => {
  const { work } = makeUntrackedOverwrite();
  seedTicket(work);
  const calls = [];
  const result = runFactory(['push', '7'], {
    root: work,
    gh: () => '',
    guard: () => [],
    git: (args) => {
      calls.push(args.join(' '));
      return runProcess('git', ['-C', work, ...args]);
    },
  });
  assert.equal(result.code, 3);
  assert.match(result.errors, /^hard stop: merge of origin\/feat\/7-x failed \(.*new\.txt/);
  assert.ok(!/merge abort/i.test(result.errors), result.errors);
  assert.ok(calls.includes('rev-parse -q --verify MERGE_HEAD'), calls.join('\n'));
  assert.ok(!calls.includes('merge --abort'), 'no merge to abort');
  assert.equal(
    readFileSync(path.join(work, 'new.txt'), 'utf8'),
    'mine\n',
    'untracked file is intact',
  );
});

test('R-55: a merge that stops with a conflict is aborted', () => {
  const { work } = makeConflict();
  seedTicket(work);
  const calls = [];
  const result = runFactory(['push', '7'], {
    root: work,
    gh: () => '',
    guard: () => [],
    git: (args) => {
      calls.push(args.join(' '));
      return runProcess('git', ['-C', work, ...args]);
    },
  });
  assert.equal(result.code, 3);
  assert.ok(calls.includes('merge --abort'));
});

// caps (R-15, R-16, R-51)

const run = (conclusion, minutes) => ({ conclusion, createdAt: iso(T0 + minutes * MINUTE) });

function capsFixture({ runs = [], lines = [logLine(T0)], ticket = {}, replies = {} } = {}) {
  const work = temporaryFolder();
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

test('B2: a skip line of the ticket adds no active time', () => {
  const { caps } = capsFixture({
    lines: [
      logLine(T0, 'skip', 'blocked by #3: no open PR (R-6)'),
      logLine(T0 + 9 * MINUTE),
      logLine(T0 + 9 * MINUTE, 'gate'),
    ],
  });
  assert.equal(caps().json.activeMinutes, 0);
});

test('B2: a hard-stop step line of the ticket still adds active time, also when it is a skip event', () => {
  const { caps } = capsFixture({
    lines: [
      logLine(T0),
      logLine(T0 + 4 * MINUTE, 'skip', 'step 5 metrics: skipped: task 5'),
      logLine(T0 + 6 * MINUTE, 'stop', 'step 6 report: wrote x'),
    ],
  });
  assert.equal(caps().json.activeMinutes, 6);
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

// hardstop steps 6 and 7 (R-12, R-29, R-45: task 2c2)

const seedActiveRun = (work) => {
  writeAtomic(
    stateFile(work, 'run.json'),
    JSON.stringify({
      runId: 'old-run',
      sessionId: 'session-1',
      sessionIds: ['session-1'],
      active: true,
      stalled: false,
      startedAt: '2026-11-17T08:00:00Z',
      only: null,
      next: { kind: 'ticket', ticket: 7 },
      waiting: null,
      stopChecks: { count: 2, lastHash: 'abc' },
    }),
  );
  seedLog(work, [logLine(T0)], 'old-run');
};
const readRun = (work) => JSON.parse(readFileSync(stateFile(work, 'run.json'), 'utf8'));
const readRunReport = (work) => readFileSync(stateFile(work, 'runs', 'old-run-report.md'), 'utf8');

test('R-12: step 6 writes the run report with the stopped ticket and the reason, and step 7 clears the run', () => {
  const { work } = makeRepository();
  seedTicket(work);
  seedActiveRun(work);
  const { overrides } = hardstopOverrides(work);
  const result = runFactory(['hardstop', '7', REASON], overrides);
  assert.equal(result.code, 0, result.errors);
  assert.match(result.out, /step 6 report: wrote \.claude\/factory\/runs\/old-run-report\.md/);
  assert.match(result.out, /step 7 clear: run cleared/);
  const run = readRun(work);
  assert.equal(run.active, false);
  assert.equal(run.next, null);
  assert.equal(run.runId, 'old-run');
  assert.deepEqual(run.sessionIds, ['session-1'], 'the session list stays for the cost read');
  const report = readRunReport(work);
  assert.match(report, new RegExp(`## Ticket that stopped\\n+- #7: ${REASON}`));
  assert.match(report, /## Hard-stop steps that failed\n+none/);
  assert.match(report, /## Resume command/);
  assert.equal(readTicket(work).stage, 'needs-human', 'ticket.json is kept');
});

test('R-12: a failed step is listed in the report, and the run is still cleared', () => {
  const { work } = makeRepository();
  seedTicket(work);
  seedActiveRun(work);
  const failing = hardstopOverrides(work, {
    replies: {
      'issue comment': () => {
        throw new HardStopError('gh issue comment failed twice: network');
      },
    },
  });
  const result = runFactory(['hardstop', '7', REASON], failing.overrides);
  assert.equal(result.code, 2);
  assert.match(readRunReport(work), /## Hard-stop steps that failed\n+- step 4 comment/);
  assert.equal(readRun(work).active, false);
  const retry = hardstopOverrides(work);
  assert.equal(runFactory(['hardstop', '7', REASON], retry.overrides).code, 0);
  assert.match(readRunReport(work), /## Hard-stop steps that failed\n+none/, 'the retry fixes it');
});

test('R-12: a second hardstop run keeps the report and run.json as they were, and posts nothing', () => {
  const { work } = makeRepository();
  seedTicket(work);
  seedActiveRun(work);
  assert.equal(runFactory(['hardstop', '7', REASON], hardstopOverrides(work).overrides).code, 0);
  const report = readRunReport(work);
  const run = readFileSync(stateFile(work, 'run.json'), 'utf8');
  const second = hardstopOverrides(work);
  const result = runFactory(['hardstop', '7', REASON], second.overrides);
  assert.equal(result.code, 0, result.errors);
  assert.match(result.out, /step 7 clear: already cleared/);
  assert.equal(readRunReport(work), report);
  assert.equal(readFileSync(stateFile(work, 'run.json'), 'utf8'), run);
  assert.equal(comments(second.calls).length, 0);
});

test('R-12: the reason in the report has secret-like strings and home paths removed', () => {
  const { work } = makeRepository();
  seedTicket(work);
  seedActiveRun(work);
  const { overrides } = hardstopOverrides(work);
  const result = runFactory(['hardstop', '7', 'fail token=abc123 in /Users/bob/x'], overrides);
  assert.equal(result.code, 0, result.errors);
  assert.doesNotMatch(readRunReport(work), /abc123|bob/);
  assert.doesNotMatch(readFileSync(stateFile(work, 'run.json'), 'utf8'), /abc123|bob/);
});

const STOP_REASON_LIMIT = 300;

test('S2: a long hard-stop reason is cut at 300 characters plus ... in run.json and in the report', () => {
  const { work } = makeRepository();
  seedTicket(work);
  seedActiveRun(work);
  const { overrides } = hardstopOverrides(work);
  const long = 'fail '.repeat(200);
  assert.equal(long.length, 1000);
  const result = runFactory(['hardstop', '7', long], overrides);
  assert.equal(result.code, 0, result.errors);
  const { reason } = readRun(work).stopped;
  assert.equal(reason, `${long.slice(0, STOP_REASON_LIMIT)}...`);
  const line = readRunReport(work)
    .split('\n')
    .find((text) => text.startsWith('- #7: '));
  assert.equal(line, `- #7: ${reason}`);
});

test('S2: a reason of 300 characters or less is stored whole', () => {
  const { work } = makeRepository();
  seedTicket(work);
  seedActiveRun(work);
  const { overrides } = hardstopOverrides(work);
  const exact = 'x'.repeat(STOP_REASON_LIMIT);
  assert.equal(runFactory(['hardstop', '7', exact], overrides).code, 0);
  assert.equal(readRun(work).stopped.reason, exact);
});

test('R-12: step 6 with a bad run.json only writes the report, warns, and treats only as null', () => {
  for (const only of [-1, 1.5, '7']) {
    const { work } = makeRepository();
    seedTicket(work);
    seedActiveRun(work);
    writeAtomic(stateFile(work, 'run.json'), JSON.stringify({ ...readRun(work), only }));
    const { overrides } = hardstopOverrides(work);
    const result = runFactory(['hardstop', '7', REASON], overrides);
    const label = `only ${JSON.stringify(only)}`;
    assert.equal(result.code, 0, `${label}: ${result.errors}`);
    assert.match(result.out, /step 6 report: wrote \.claude\/factory\/runs\/old-run-report\.md/);
    assert.equal(
      result.errors,
      'warning: run.json only is not valid: treated as all tickets\n',
      label,
    );
    assert.match(readRunReport(work), /Scope: all tickets/, label);
    assert.equal(readRun(work).active, false, label);
  }
});
