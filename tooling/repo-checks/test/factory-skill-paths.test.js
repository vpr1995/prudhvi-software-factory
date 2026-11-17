// Tests for the /factory skill and the removal of /work-ticket (design factory-daily-run 6 and 8, task 4a).
// R-2 (part): /factory is the only entry point, /work-ticket does not exist.
// R-17 (part): the skill runs the local test guard before the push, one fix round, then a hard stop.
// R-25 (part): no skill or agent file names the state folder or posts a comment with gh.
// The tests read the real repository files. They call no `gh` and no network.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { scanFolders } from '../scripts/lib/factory-skill-scan.mjs';
import { exists, readRepositoryFile } from '../scripts/lib/fs-io.mjs';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const SKILL = '.claude/skills/factory/SKILL.md';
const OLD_SKILL_FOLDER = '.claude/skills/work-ticket';
const OLD_NAME = 'work-ticket';
// Design section 6: the live docs. `docs/designs/**` is history and keeps the old name.
const SCOPE_PATHSPECS = ['.claude', 'docs/guides', 'docs/standards', ':(glob)**/CLAUDE.md'];
// The commands of scripts/factory.mjs. A skill line with another command must say `(built in task`.
const COMMANDS = new Set([
  'caps',
  'comment',
  'findings',
  'hardstop',
  'next',
  'note',
  'push',
  'read',
  'report',
  'round',
  'route',
  'stage',
  'start',
  'status',
  'stop',
  'wait',
]);
const SKILL_COMMAND = /factory\.mjs\s+([a-z][\w-]*)/g;
const TOP_STEP = /^\d+\. /;

/** @returns {string[]} Tracked and new files in the scope of design section 6 that exist now. */
function scopeFiles() {
  const result = spawnSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', ...SCOPE_PATHSPECS],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, `git ls-files failed: ${result.stderr}`);
  return result.stdout
    .split('\0')
    .filter((file) => file !== '')
    .filter((file) => exists(`${ROOT}${file}`));
}

const skillText = () => readRepositoryFile(ROOT, SKILL);

// R-25

test('R-25: no skill or agent file names the state folder or posts a comment with gh', () => {
  const hits = scanFolders(ROOT, ['.claude/skills', '.claude/agents']).map(
    ({ file, line, rule }) => `${file}:${String(line)} ${rule}`,
  );
  assert.deepEqual(hits, []);
});

// R-2

test('R-2: /work-ticket does not exist and /factory does', () => {
  assert.equal(exists(`${ROOT}${OLD_SKILL_FOLDER}`), false, `${OLD_SKILL_FOLDER} must not exist`);
  assert.equal(exists(`${ROOT}${SKILL}`), true, `${SKILL} must exist`);
});

test('R-2: the skill has the front matter of /factory and works one ticket for /factory <n>', () => {
  const text = skillText();
  const [open, ...rest] = text.split('\n');
  assert.equal(open, '---');
  const front = rest.slice(0, rest.indexOf('---'));
  assert.ok(front.includes('name: factory'), 'front matter has name: factory');
  assert.ok(
    front.some((line) => line.startsWith('description: ')),
    'front matter has a description',
  );
  assert.match(text, /factory\.mjs start <n>/);
});

test('R-2: no file in the scope of design section 6 names the old skill', () => {
  const files = scopeFiles();
  assert.ok(files.includes('CLAUDE.md'), 'the scope has the root CLAUDE.md');
  assert.ok(files.includes(SKILL), 'the scope has the factory skill');
  const hits = files.filter((file) => readRepositoryFile(ROOT, file).includes(OLD_NAME));
  assert.deepEqual(hits, []);
});

test('R-2: the routing table row "Work a ticket from the board" uses the factory skill', () => {
  const row = readRepositoryFile(ROOT, 'CLAUDE.md')
    .split('\n')
    .find((line) => line.includes('Work a ticket from the board'));
  assert.ok(row !== undefined, 'the row exists');
  assert.ok(row.includes('.claude/skills/factory/SKILL.md'), 'the row links the factory skill');
});

// The skill names only commands that exist, or marks the step as built in a later task.

test('the skill calls only factory.mjs commands that exist, or marks a gap with "(built in task"', () => {
  const unmarked = skillText()
    .split('\n')
    .flatMap((line) =>
      [...line.matchAll(SKILL_COMMAND)]
        .map((match) => match[1])
        .filter((command) => !COMMANDS.has(command) && !line.includes('(built in task'))
        .map((command) => `${command}: ${line.trim()}`),
    );
  assert.deepEqual(unmarked, []);
});

test('the skill uses the commands of the loop, the hard stop and the CI wait', () => {
  const used = new Set([...skillText().matchAll(SKILL_COMMAND)].map((match) => match[1]));
  for (const command of ['start', 'next', 'stage', 'push', 'hardstop', 'wait', 'stop', 'status']) {
    assert.ok(used.has(command), `the skill calls factory.mjs ${command}`);
  }
});

// R-17 (part)

/** @returns {string} The numbered step of the skill that has the line with `factory.mjs push`. */
function pushStep() {
  const lines = skillText().split('\n');
  const at = lines.findIndex((line) => line.includes('factory.mjs push'));
  assert.notEqual(at, -1, 'the skill calls factory.mjs push');
  let start = at;
  while (start > 0 && !TOP_STEP.test(lines[start])) start -= 1;
  let end = at + 1;
  while (end < lines.length && !TOP_STEP.test(lines[end]) && !lines[end].startsWith('## ')) {
    end += 1;
  }
  return lines.slice(start, end).join('\n');
}

test('R-17: the push step runs the test guard, gives one fix round, then a hard stop', () => {
  const step = pushStep();
  const guard = step.indexOf('test guard');
  const fixRound = step.indexOf('one fix round');
  const stop = step.indexOf('factory.mjs hardstop');
  assert.ok(guard !== -1, 'the push step names the test guard');
  assert.ok(fixRound !== -1, 'the push step gives one fix round');
  assert.ok(stop !== -1, 'the push step ends in factory.mjs hardstop');
  assert.ok(guard < fixRound && fixRound < stop, 'order: test guard, one fix round, hard stop');
});

test('R-17: the push step sends "check config changed" to the router and the PR body', () => {
  const step = pushStep();
  assert.match(step, /check config changed/);
  assert.match(step, /risk:high/);
  assert.match(step, /PR body/);
});

test('R-17: the push step comes after the commit and after the review rounds', () => {
  const text = skillText();
  const push = text.indexOf('factory.mjs push');
  assert.ok(text.lastIndexOf('git commit', push) !== -1, 'a commit comes before the push');
  assert.ok(text.lastIndexOf('pre-pr', push) !== -1, 'the review rounds come before the push');
});

// R-10, R-11, R-13

test('R-10, R-11, R-13: the skill names the PR section and the hard-stop cases', () => {
  const text = skillText();
  assert.match(text, /Decisions I made/);
  for (const reason of [
    'high-tier path',
    'contradicts itself',
    'secret',
    'deploy',
    'CI timeout',
    '3 failed',
  ]) {
    assert.ok(text.includes(reason), `the skill names the hard-stop case "${reason}"`);
  }
});
