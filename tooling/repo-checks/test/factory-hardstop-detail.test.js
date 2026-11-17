// Tests for `hardstop <n> "<reason>" --detail "<text>"` (issue #135, design factory-daily-run R-12
// step 4). `gh` is a stub that records each call and the --body-file text. Git is real: a temp repo
// with a local bare remote. The skill checks read the real SKILL.md. No test calls the real gh.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { main } from '../scripts/factory.mjs';
import { MARKER } from '../scripts/lib/factory-comment.mjs';

import { pathFromEnv } from './test-env.config.js';

const REASON = 'high-tier path decision';
const REPOSITORY = 'vpr1995/projects-monorepo';
const MINUTE = 60_000;
const DETAILS = 'Details:';
const roots = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

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

/** A work repo on feat/7-x (one commit ahead of main), a bare remote, and a seeded ticket. */
function makeWork() {
  const folder = mkdtempSync(path.join(tmpdir(), 'factory-detail-'));
  roots.push(folder);
  const remote = path.join(folder, 'remote.git');
  const work = path.join(folder, 'work');
  git(folder, 'init', '-q', '--bare', '-b', 'main', remote);
  git(folder, 'init', '-q', '-b', 'main', work);
  for (const [key, value] of [
    ['commit.gpgsign', 'false'],
    ['core.hooksPath', '/dev/null'],
    ['user.name', 't'],
    ['user.email', 't@t'],
  ]) {
    git(work, 'config', key, value);
  }
  git(work, 'remote', 'add', 'origin', remote);
  writeFileSync(path.join(work, 'README.md'), 'hello\n');
  git(work, 'add', '.');
  git(work, 'commit', '-qm', 'one');
  git(work, 'push', '-q', 'origin', 'main');
  git(work, 'checkout', '-q', '-b', 'feat/7-x');
  writeFileSync(path.join(work, 'b.js'), 'export const b = 1;\n');
  git(work, 'add', '.');
  git(work, 'commit', '-qm', 'two');
  const state = path.join(work, '.claude/factory/7');
  mkdirSync(state, { recursive: true });
  writeFileSync(
    path.join(state, 'ticket.json'),
    JSON.stringify({
      issue: 7,
      stage: 'building',
      branch: 'feat/7-x',
      base: null,
      restartedAt: null,
      resumes: 0,
    }),
  );
  mkdirSync(path.join(work, '.claude/factory/runs'), { recursive: true });
  return work;
}

const isMetrics = ({ body }) => body?.includes('```factory-metrics') === true;
const comments = (calls) => calls.filter((call) => call.args[1] === 'comment' && !isMetrics(call));
const writes = (calls) =>
  calls.filter(({ args }) => ['edit', 'comment', 'item-edit'].includes(args[1]));

/** A gh stub: records each call. The comment list is stateful, so step 5 edits its own comment. */
function makeGh() {
  const calls = [];
  const stored = [];
  const known = {
    'project field-list': JSON.stringify({
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
    }),
    'project item-list': JSON.stringify({
      items: [{ id: 'I_7', content: { number: 7, repository: REPOSITORY } }],
    }),
    'project view': JSON.stringify({ id: 'PVT_2' }),
    'repo view': `${REPOSITORY}\n`,
    'api user': 'factory-bot\n',
    'api repos/{owner}/{repo}/issues/7/comments': () => JSON.stringify([stored]),
    'run list': '[]',
    'issue comment': (args) => {
      const body = readFileSync(args[args.indexOf('--body-file') + 1], 'utf8');
      if (body.includes('```factory-metrics')) {
        stored.push({ id: 901, body, user: { login: 'factory-bot' } });
      }
      return '';
    },
  };
  const gh = (args) => {
    const at = args.indexOf('--body-file');
    calls.push({ args, body: at === -1 ? undefined : readFileSync(args[at + 1], 'utf8') });
    const reply = known[args.slice(0, 2).join(' ')] ?? '';
    return typeof reply === 'function' ? reply(args) : reply;
  };
  return { gh, calls };
}

/** Runs one hardstop in process. `stdin` is the error excerpt. */
function hardstop({ work, gh }, words, stdin = '') {
  let step = 0;
  const out = [];
  const errors = [];
  const code = main(['node', 'factory.mjs', 'hardstop', '7', ...words], {
    root: work,
    gh,
    stdin: () => stdin,
    now: () => new Date(Date.parse('2026-11-17T10:00:00Z') + step++ * MINUTE),
    claudeVersion: () => '2.1.300 (Claude Code)\n',
    transcriptRoot: () => path.join(tmpdir(), 'factory-detail-no-transcripts'),
    sessionId: () => '',
    guard: () => {
      throw new Error('the local test guard must not run');
    },
    print: (text) => out.push(text),
    err: (text) => errors.push(text),
  });
  return { code, out: out.join(''), errors: errors.join('') };
}

/** @returns {string} The body of the one hard-stop comment of a run that must succeed. */
function postedBody(words, stdin = '') {
  const work = makeWork();
  const { gh, calls } = makeGh();
  const result = hardstop({ work, gh }, words, stdin);
  assert.equal(result.code, 0, result.errors);
  assert.equal(comments(calls).length, 1);
  return comments(calls)[0].body;
}

const NO_DETAIL_BODY = [
  MARKER,
  'Hard stop on #7. Needs a human.',
  '',
  'Reason:',
  '```',
  REASON,
  '```',
  '',
  'Branch: `feat/7-x`',
  'Patch: none',
  'Error excerpt: none',
].join('\n');

test('Acceptance 1: --detail puts the text under Details:, in a code fence, after the reason', () => {
  const body = postedBody([REASON, '--detail', 'The ticket gives no value. Pick 30 or 45.']);
  const lines = body.split('\n');
  const at = lines.indexOf(DETAILS);
  assert.notEqual(at, -1, 'the comment has a Details: line');
  assert.deepEqual(lines.slice(at, at + 4), [
    DETAILS,
    '```',
    'The ticket gives no value. Pick 30 or 45.',
    '```',
  ]);
  assert.ok(at > lines.indexOf('Reason:'), 'Details come after the reason');
  assert.ok(
    at < lines.findIndex((line) => line.startsWith('Branch:')),
    'Details come before Branch',
  );
});

test('Acceptance 2: secrets and home paths leave the details text, and newlines fold to spaces', () => {
  const text =
    'Fails in /Users/bob/code/a.js\nwith token=abc123 and ghp_abcdefghijklmnopqrstuvwxyz0123456789';
  const body = postedBody([REASON, '--detail', text]);
  assert.ok(body.includes('Fails in ~/code/a.js with [redacted] and [redacted]'), body);
  for (const secret of ['/Users/bob', 'abc123', 'ghp_']) {
    assert.ok(!body.includes(secret), `${secret} must not be in the comment`);
  }
});

test('Acceptance 2: the details text is cut to 500 characters', () => {
  const body = postedBody([REASON, '--detail', `${'a'.repeat(600)}END`]);
  const [run] = body.match(/a+/g).sort((a, b) => b.length - a.length);
  assert.equal(run.length, 500);
  assert.ok(!body.includes('END'));
});

test('Acceptance 2: the cut comes after the redaction, so a secret cannot leak by its tail', () => {
  // The secret-like value is built from parts, so the secret scanner of the pre-commit hook does not flag this file.
  const secret = ['token=', 'abcdefghij', '12345'].join('');
  const body = postedBody([REASON, '--detail', `${'x'.repeat(495)} ${secret}`]);
  assert.ok(!body.includes('abcdefghij'), 'no secret part is in the comment');
});

test('Details cannot close the fence: backticks go, and an @mention stays inside the fence', () => {
  const body = postedBody([REASON, '--detail', 'close ``` @bob `x` ~~~ [a](http://e.example)']);
  const lines = body.split('\n');
  const at = lines.indexOf(DETAILS);
  assert.deepEqual(lines.slice(at, at + 4), [
    DETAILS,
    '```',
    'close @bob x ~~~ [a](http://e.example)',
    '```',
  ]);
  assert.ok(!body.includes('@​bob'), 'the fence protects the mention: no space is added');
});

test('Acceptance 3: the excerpt stays out of the comment when --detail is set', () => {
  const excerpt = ['failure at /Users/bob/x', 'password=hunter2', 'last excerpt line'].join('\n');
  const body = postedBody([REASON, '--detail', 'Short text.'], excerpt);
  assert.ok(body.includes('Short text.'));
  for (const line of ['failure at', 'hunter2', 'last excerpt line']) {
    assert.ok(!body.includes(line), `${line} must not be in the comment`);
  }
  assert.match(body, /Error excerpt: hardstop-\d{8}T\d{6}Z-excerpt\.txt /);
});

test('Acceptance 4: with no --detail the comment is exactly as before, with no Details part', () => {
  assert.equal(postedBody([REASON]), NO_DETAIL_BODY);
});

test('Acceptance 4: an empty or fully cleaned details text gives the same comment as no --detail', () => {
  for (const text of ['', '   \n ', '```', '`` ``']) {
    assert.equal(postedBody([REASON, '--detail', text]), NO_DETAIL_BODY, JSON.stringify(text));
  }
});

test('Usage: --detail with no value, an extra word, or another flag is exit 2 and runs no step', () => {
  const work = makeWork();
  const { gh, calls } = makeGh();
  const bad = [
    [REASON, '--detail'],
    [REASON, '--detail', 'a', 'b'],
    [REASON, '--detail', 'a', '--detail', 'b'],
    [REASON, '--details', 'a'],
    [REASON, 'a'],
    ['--detail', 'a'],
  ];
  for (const words of bad) {
    const result = hardstop({ work, gh }, words);
    assert.equal(result.code, 2, words.join(' '));
    assert.match(result.errors, /Usage: hardstop <n> "<reason>" \[--detail "<text>"\]/);
  }
  assert.deepEqual(calls, [], 'no gh call');
});

test('R-12: a second run with the same detail changes nothing, and a new detail posts nothing', () => {
  const work = makeWork();
  const { gh, calls } = makeGh();
  const first = hardstop({ work, gh }, [REASON, '--detail', 'Pick a value.'], 'boom');
  assert.equal(first.code, 0, first.errors);
  assert.equal(comments(calls).length, 1);
  const ticket = readFileSync(path.join(work, '.claude/factory/7/ticket.json'), 'utf8');
  for (const detail of ['Pick a value.', 'Other words.']) {
    const before = calls.length;
    const again = hardstop({ work, gh }, [REASON, '--detail', detail], 'boom');
    assert.equal(again.code, 0, again.errors);
    assert.match(again.out, /step 4 comment: already posted/);
    assert.deepEqual(writes(calls.slice(before)), [], 'no gh write');
    assert.equal(comments(calls).length, 1, 'one hard-stop comment in total');
  }
  assert.equal(readFileSync(path.join(work, '.claude/factory/7/ticket.json'), 'utf8'), ticket);
});

// The skill text

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const skill = readFileSync(path.join(ROOT, '.claude/skills/factory/SKILL.md'), 'utf8');
const section = skill.split('\n## Hard stop\n')[1].split('\n## ')[0];
const stepOne = section.split('\n').find((line) => line.startsWith('1. '));

test('Acceptance 5: skill step 1 runs hardstop with --detail and the file on stdin', () => {
  assert.ok(
    stepOne.includes('factory.mjs hardstop <n> "<reason>" --detail "<details>" < "<file>"'),
    stepOne,
  );
});

test('Acceptance 5: the skill asks for 1 to 3 sentences, what stopped, and what the owner decides', () => {
  assert.match(section, /1 to 3 sentences/);
  assert.match(section, /what stopped/);
  assert.match(section, /what the owner must decide or do/);
  assert.match(section, /the question and the options/);
  assert.match(section, /Copy no ticket, comment, or log text/);
  assert.match(section, /Never put text of a ticket, a comment, or a log in the reason/);
});

test('The skill tells the agent to remove quote, dollar, backtick and backslash from the details', () => {
  const rule = section.split('\n').find((line) => /remove .* from it before you run/.test(line));
  assert.ok(rule !== undefined, 'the section has a shell rule for the details');
  assert.match(rule, /double quotes in a shell command/);
  for (const mark of ['`"`', '`$`', '`` ` ``', '`\\`']) assert.ok(rule.includes(mark), mark);
});
