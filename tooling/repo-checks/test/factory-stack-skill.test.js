// Tests for the stack skill steps (design factory-daily-run 8, task 7b, #112).
// R-35 (part): the stack line in the PR body. R-36 (part): the skill branches from the blocker
// branch and opens a draft PR that targets it. R-37: the base of a stacked ticket is the stack base.
// R-38, R-39: `restack`, then `verify`. Each check reads one step of a skill or a doc, so that
// deleting the step fails the test. The tests read the real repository files. They call no `gh`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { COMMAND_NAMES } from '../scripts/factory.mjs';
import { readRepositoryFile } from '../scripts/lib/fs-io.mjs';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const FACTORY = '.claude/skills/factory/SKILL.md';
const PR_DESCRIPTION = '.claude/skills/pr-description/SKILL.md';
const GIT_WORKFLOW = 'docs/standards/git-workflow.md';
const RISK_TIERS = 'docs/standards/risk-tiers.md';
const CALL = 'node tooling/repo-checks/scripts/factory.mjs';
const STACK_LINE = 'Stacked on #<m>. Merge #<m> first.';
const TOP_STEP = /^\d+\. /;

const read = (file) => readRepositoryFile(ROOT, file);

/** @returns {string[]} The lines of the section `## <title>` of a file, without the heading. */
function sectionLines(file, title) {
  const lines = read(file).split('\n');
  const start = lines.indexOf(`## ${title}`);
  assert.notEqual(start, -1, `${file} has the section "${title}"`);
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  return lines.slice(start + 1, end === -1 ? undefined : end);
}

/** @returns {string[]} The numbered steps of a section, each with its sub-lines. */
function steps(file, title) {
  const out = [];
  for (const line of sectionLines(file, title)) {
    if (TOP_STEP.test(line)) out.push(line);
    else if (out.length > 0) out[out.length - 1] += `\n${line}`;
  }
  return out;
}

const workStep = (needle) => {
  const found = steps(FACTORY, 'Work a ticket').find((step) => step.includes(needle));
  assert.ok(found !== undefined, `a step of "Work a ticket" has "${needle}"`);
  return found;
};

/** @returns {boolean} True when the Bash allow rule matches the command. */
function ruleMatches(rule, command) {
  const inner = /^Bash\((.*)\)$/.exec(rule)?.[1];
  if (inner === undefined) return false;
  if (!inner.endsWith(':*')) return command === inner;
  const prefix = inner.slice(0, -2);
  return command === prefix || command.startsWith(`${prefix} `);
}

test('#112 R-36: a stacked start branches from the blocker branch, then claims', () => {
  const text = workStep('git fetch origin');
  assert.match(text, /git switch -c <type>\/<n>-<short-kebab> "origin\/<base>"/);
  assert.match(text, /stacked on/i);
  assert.match(text, /branch name of #<n> is not valid/);
});

test('#112 R-36: the PR of a stacked ticket is a draft that targets the blocker branch, with the stack line', () => {
  const text = workStep('gh pr create');
  assert.ok(text.includes(STACK_LINE), 'the PR step has the stack line');
  assert.match(text, /gh pr create --draft --base <base> --title/);
  assert.match(text, /gh pr create --base main --title/, 'a plain ticket still targets main');
});

test('#112 R-38 R-39: the skill restacks, runs verify, and goes back through CI', () => {
  assert.ok(COMMAND_NAMES.has('restack'), 'factory.mjs has the command restack');
  assert.ok(COMMAND_NAMES.has('stack'), 'factory.mjs has the command stack');
  const text = sectionLines(FACTORY, 'Restack').join('\n');
  assert.ok(text.includes(`${CALL} restack <t>`), 'the section runs restack');
  assert.ok(text.includes(`${CALL} stack plan <t>`), 'the section checks the parent PR');
  assert.match(text, /`verify` skill/);
  assert.ok(text.indexOf(`${CALL} stage <t> reviewing`) > text.indexOf('restack <t>'));
  assert.ok(text.includes(`${CALL} stage <t> ci`), 'the section moves to ci');
  assert.match(text, /Run verify now/);
  const loop = steps(FACTORY, 'Loop')[0];
  assert.match(loop, /"Restack"/, 'the loop checks the stacks before next');
  const comment = steps(FACTORY, 'Comment fix round').at(-1);
  assert.match(comment, /"Restack"/, 'a fix of the blocker restacks the child');
});

test('#112 R-42: the loop waits for the blocker CI, then calls next again', () => {
  const bullet = sectionLines(FACTORY, 'Loop').find((line) =>
    line.startsWith('   - `wait for the CI of PR #<m>`'),
  );
  assert.ok(bullet !== undefined, 'the loop has the wait bullet');
  assert.ok(bullet.includes(`${CALL} wait <m>`), 'the bullet runs wait on the blocker PR');
  assert.match(bullet, /background/);
  assert.match(bullet, /run `next` again/);
});

test('#112: the skills have no gap note for the stack steps', () => {
  for (const file of [FACTORY, PR_DESCRIPTION]) {
    assert.doesNotMatch(read(file), /task 7b|#112/, `${file} has no gap note`);
  }
  assert.doesNotMatch(read(PR_DESCRIPTION), /not built yet/);
});

test('#112: each git, gh and node command of "Restack" has an allow rule', () => {
  const root = JSON.parse(read('.claude/settings.json')).permissions.allow;
  const setup = sectionLines(FACTORY, 'Worktree setup (owner, once)');
  const open = setup.indexOf('```json');
  const block = setup.slice(open + 1, setup.indexOf('```', open + 1)).join('\n');
  const rules = [...root, ...JSON.parse(block).permissions.allow];
  const commands = sectionLines(FACTORY, 'Restack')
    .flatMap((line) => [...line.matchAll(/`([^`]+)`/g)].map((match) => match[1]))
    .filter((span) => /^(git|gh|rm|mktemp|node|npx) /.test(span));
  assert.ok(commands.length >= 4, 'the section has command spans');
  const missing = commands.filter((c) => !rules.some((rule) => ruleMatches(rule, c)));
  assert.deepEqual([...new Set(missing)], []);
});

test('#112 R-35 R-37: pr-description opens a stacked PR as a draft on the stack base', () => {
  const text = steps(PR_DESCRIPTION, 'Steps').find((step) => step.includes('gh pr create'));
  assert.ok(text !== undefined, 'a step has gh pr create');
  assert.match(text, /gh pr create --draft --base <base> --title/);
  assert.match(text, /gh pr create --base main --title/);
  assert.match(text, /`base` of the route JSON/);
  const facts = steps(PR_DESCRIPTION, 'Steps').find((step) => step.includes('main..HEAD'));
  assert.match(facts ?? '', /origin\/<base>/, 'the facts step uses the stack base');
  assert.ok(read(PR_DESCRIPTION).includes(STACK_LINE), 'the stack line stays');
});

test('#112: git-workflow has the rules of stacked PRs', () => {
  const text = sectionLines(GIT_WORKFLOW, '9. Stacked PRs').join('\n');
  assert.match(text, /2 or less/);
  assert.match(text, /merge commit/i);
  assert.match(text, /no rebase|Do not rebase/i);
  assert.match(text, /force push/i);
  assert.match(text, /bottom first/i);
  assert.match(text, /retarget/i);
});

test('#112 R-37: risk-tiers uses the stack base for the tier and the diff count', () => {
  const text = read(RISK_TIERS);
  assert.match(text, /origin\/<base>\.\.\.HEAD/);
  assert.match(text, /stacked/i);
});
