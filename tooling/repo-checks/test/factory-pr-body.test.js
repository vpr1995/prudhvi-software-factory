// Tests for the PR body (design factory-daily-run 8, task 4c, #110).
// R-20 (part): one routing line in the PR body. R-21 (part): the `risk:*` label from the router.
// R-34 (part): the "Over budget" line. R-35 (part): the sections "Decisions I made" and
// "Over budget", and the stack line. Each check reads one step of the skill, so that deleting the
// step fails the test. This file is new: factory-skill-paths.test.js is over 400 lines.
// The tests read the real repository files. They call no `gh` and no network.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { COMMAND_NAMES } from '../scripts/factory.mjs';
import { route, routingLine } from '../scripts/lib/factory-route.mjs';
import { readRepositoryFile } from '../scripts/lib/fs-io.mjs';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const PR_DESCRIPTION = '.claude/skills/pr-description/SKILL.md';
const TEMPLATE = '.github/pull_request_template.md';
const FACTORY_SKILL = '.claude/skills/factory/SKILL.md';
const FACTORY_CALL = 'node tooling/repo-checks/scripts/factory.mjs';
const TOP_STEP = /^\d+\. /;
const SIX = [
  '## Summary',
  '## Linked issue',
  '## Testing',
  '## Risk tier',
  '## How to revert',
  '## Feature flag',
];
const NEW_SECTIONS = ['## Decisions I made', '## Over budget'];

/** @returns {boolean} True when the Bash allow rule matches the command (same rule as factory-skill-paths). */
function ruleMatches(rule, command) {
  const inner = /^Bash\((.*)\)$/.exec(rule)?.[1];
  if (inner === undefined) return false;
  if (inner.endsWith(':*')) {
    const prefix = inner.slice(0, -2);
    return command === prefix || command.startsWith(`${prefix} `);
  }
  return command === inner;
}

/** @returns {string[]} The numbered steps of the `## Steps` section of a skill file, each with its sub-lines. */
function stepsOfFile(file, section = '## Steps') {
  const lines = readRepositoryFile(ROOT, file).split('\n');
  const start = lines.indexOf(section);
  assert.notEqual(start, -1, `${file} has a "${section}" section`);
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  const steps = [];
  for (const line of lines.slice(start + 1, end === -1 ? undefined : end)) {
    if (TOP_STEP.test(line)) steps.push(line);
    else if (steps.length > 0) steps[steps.length - 1] += `\n${line}`;
  }
  return steps;
}

/** @returns {{ number: number, text: string }} The first step of the file that has the text (number from 1). */
function fileStepWith(file, needle, section) {
  const steps = stepsOfFile(file, section);
  const index = steps.findIndex((step) => step.includes(needle));
  assert.notEqual(index, -1, `a step of ${file} has "${needle}"`);
  return { number: index + 1, text: steps[index] };
}

/** @returns {string[]} The `## ` headings of the PR body in a file, in order. */
function headings(file) {
  return readRepositoryFile(ROOT, file)
    .split('\n')
    .filter((line) => line.startsWith('## '));
}

/** @returns {object} A router result for the given size and check-config flag. */
function routed({ size, checkConfig = false, path = 'projects/x/src/a.ts' }) {
  return route({
    base: 'origin/main',
    changedFiles: [{ path, oldPath: path, added: 10, deleted: 0 }],
    size,
    checkConfig,
  });
}

const bodyStep = () => fileStepWith(PR_DESCRIPTION, 'Write tool').text;
const routeStep = () => fileStepWith(PR_DESCRIPTION, `${FACTORY_CALL} route <n>`).text;
const pushStep = () => fileStepWith(PR_DESCRIPTION, 'git push -u origin HEAD').text;
const createStep = () => fileStepWith(PR_DESCRIPTION, 'gh pr create').text;
const skillText = () => readRepositoryFile(ROOT, PR_DESCRIPTION);

test('#110 R-35: the skill body step and the template have the sections "Decisions I made" and "Over budget"', () => {
  const body = bodyStep();
  for (const section of NEW_SECTIONS) {
    assert.ok(body.includes(`\`${section}\``), `the body step names ${section}`);
    assert.ok(headings(TEMPLATE).includes(section), `the template has ${section}`);
  }
});

test('#110 R-35: the six required sections stay first and in order, the new sections follow in a fixed order', () => {
  const body = bodyStep();
  const positions = [...SIX, ...NEW_SECTIONS].map((section) => body.indexOf(`- \`${section}\`:`));
  assert.ok(
    positions.every((position) => position !== -1),
    'the body step names each section',
  );
  assert.deepEqual(
    positions,
    [...positions].sort((a, b) => a - b),
    'skill order: six sections, Decisions I made, Over budget',
  );
  const template = headings(TEMPLATE);
  assert.deepEqual(
    template.slice(0, SIX.length + NEW_SECTIONS.length),
    [...SIX, ...NEW_SECTIONS],
    'template order: six sections, Decisions I made, Over budget',
  );
  assert.match(body, /six sections[^\n]*required/);
});

test('#110 R-35: "Decisions I made" reads the decisions of the ticket, or says None', () => {
  const line = bodyStep()
    .split('\n')
    .find((entry) => entry.startsWith('   - `## Decisions I made`:'));
  assert.ok(line !== undefined, 'the body step has a Decisions I made line');
  assert.ok(line.includes(`${FACTORY_CALL} read <n> decisions`), 'it reads the stored decisions');
  assert.match(line, /exits 2[^\n]*None|None[^\n]*exits 2/);
  assert.match(line, /## Summary/, 'it drops the stored Summary heading');
  assert.ok(COMMAND_NAMES.has('read'), 'factory.mjs has the command read');
});

test('#110 R-35: the stack line is the first line of the body of a stacked PR, and only then', () => {
  const body = bodyStep();
  const line = body
    .split('\n')
    .find((entry) => entry.includes('Stacked on #<m>. Merge #<m> first.'));
  assert.ok(line !== undefined, 'the body step has the stack line');
  assert.match(line, /stacked PR/i);
  assert.match(line, /first line/);
  assert.match(line, /Other PR: no stack line/);
  assert.ok(
    readRepositoryFile(ROOT, TEMPLATE).includes('Stacked on #<m>. Merge #<m> first.'),
    'the template has the stack line',
  );
});

test('#110 R-20: the body has the Routing line copied from the output of route <n>', () => {
  assert.ok(COMMAND_NAMES.has('route'), 'factory.mjs has the command route');
  const text = routeStep();
  assert.match(text, /`Routing: \.\.\.`/);
  assert.match(text, /first line/);
  assert.match(text, /Copy it as it is/);
  const risk = bodyStep()
    .split('\n')
    .find((entry) => entry.startsWith('   - `## Risk tier`:'));
  assert.ok(risk?.includes('Routing line'), 'the Risk tier section holds the Routing line');
  assert.ok(readRepositoryFile(ROOT, TEMPLATE).includes('Routing: '), 'the template has the line');
  // The real router line starts with the text that the skill tells the agent to copy.
  assert.match(routingLine(routed({ size: 3 })), /^Routing: tier medium; passes spec-reviewer/);
});

test('#110 R-21: the label is risk:<tier> with the tier of the route output', () => {
  const text = routeStep();
  assert.match(text, /`tier` of the output/);
  const create = createStep();
  assert.ok(create.includes('--label risk:<tier>'), 'gh pr create sets the label');
  assert.match(create, /tier of step \d+/);
  assert.match(create, /--body-file <path>/);
  assert.equal(routed({ size: 3, path: 'projects/x/src/a.ts' }).tier, 'medium');
  assert.equal(routed({ size: 3, path: 'tooling/x.mjs' }).tier, 'high', 'highest tier of a path');
});

test('#110 R-21: "check config changed" is risk:high and goes in the PR body', () => {
  const text = routeStep();
  const line = text.split('\n').find((entry) => entry.includes('check config changed'));
  assert.ok(line !== undefined, 'the route step names the finding');
  assert.match(line, /risk:high/);
  assert.match(line, /Risk tier/);
  assert.equal(routed({ size: 3, checkConfig: true }).tier, 'high', 'the router gives high');
});

test('#110 R-34: the "Over budget" section uses the count and the budget of the route output', () => {
  const line = bodyStep()
    .split('\n')
    .find((entry) => entry.startsWith('   - `## Over budget`:'));
  assert.ok(line !== undefined, 'the body step has an Over budget line');
  for (const field of ['`changedLines`', '`budget`', '`overBudget`']) {
    assert.ok(line.includes(field), `the Over budget line names ${field}`);
  }
  assert.match(line, /`overBudget` is true/);
  assert.match(line, /Reason/);
  assert.match(line, /None/);
});

test('#110 R-34: the router budgets are 1:150, 2:300, 3:500, 4 or 5:800, and a bad size warns on the routing line', () => {
  const budgets = [1, 2, 3, 4, 5].map((size) => routed({ size }).budget);
  assert.deepEqual(budgets, [150, 300, 500, 800, 800]);
  for (const size of [undefined, 6]) {
    const result = routed({ size });
    assert.equal(result.budget, 800);
    assert.equal(result.warnings.length, 1, `size ${String(size)} adds one warning`);
    assert.match(routingLine(result), /warnings: /);
  }
  assert.equal(routed({ size: 1 }).overBudget, false);
});

test('#110: with a ticket the skill skips the push, with no ticket it keeps the raw push', () => {
  const text = pushStep();
  const withTicket = text.indexOf('With a ticket');
  const noTicket = text.indexOf('No ticket');
  assert.ok(withTicket !== -1 && noTicket !== -1, 'the push step has both cases');
  assert.ok(withTicket < noTicket, 'the ticket case comes first');
  assert.match(text.slice(withTicket, noTicket), /skip this step/);
  assert.ok(
    text.slice(withTicket, noTicket).includes(`${FACTORY_CALL} push <n>`),
    'the ticket case names the guarded push',
  );
  assert.ok(text.slice(noTicket).includes('git push -u origin HEAD'), 'no ticket: raw push');
  assert.doesNotMatch(text.slice(0, noTicket), /git push/, 'no raw push in the ticket case');
  const pushSteps = stepsOfFile(PR_DESCRIPTION).filter((step) => step.includes('git push'));
  assert.equal(pushSteps.length, 1, 'only one step has a raw push');
  assert.match(skillText(), /With a ticket, never push with git/);
});

test('#110: the ticket is the branch number first, digits only, as in pre-pr', () => {
  const { text } = fileStepWith(PR_DESCRIPTION, 'git branch --show-current');
  assert.match(text, /sed -nE 's#\^\[a-z\]\+\/\(\[0-9\]\+\)-\.\*#\\1#p'/);
  assert.match(text, /`#<n>` or `ticket <n>` of the request/);
  assert.match(text, /only when the branch has none/);
  assert.ok(text.includes('^[1-9][0-9]*$'), 'the number pattern is digits only');
  assert.match(text, /stop and ask the human/);
  assert.match(text, /No number: no ticket/);
});

test('#110: the body file is a mktemp file written with the Write tool, no heredoc, removed after', () => {
  const body = bodyStep();
  assert.ok(body.includes('`mktemp /tmp/factory-pr.XXXXXX`'), 'mktemp makes the path');
  assert.match(body, /Write tool/);
  assert.match(body, /Do not write it with a shell heredoc/);
  const text = skillText();
  assert.doesNotMatch(text, /<<-?'?[A-Z]+/, 'no heredoc in the skill');
  assert.doesNotMatch(text, /pr-body\.md/, 'no fixed body path');
  assert.doesNotMatch(text, /mkdir/, 'no folder is made');
  const create = createStep();
  const remove = create.indexOf('rm /tmp/factory-pr.<suffix>');
  assert.ok(remove > create.indexOf('gh pr create'), 'rm follows the create');
  assert.match(create.slice(remove), /also when `gh pr create` fails/);
});

test('#110: each node command of pr-description has an allow rule in .claude/settings.json', () => {
  const rules = JSON.parse(readRepositoryFile(ROOT, '.claude/settings.json')).permissions.allow;
  const commands = [...skillText().matchAll(/`([^`]+)`/g)]
    .map((match) => match[1])
    .filter((span) => span.startsWith('node tooling'))
    .map((span) => span.replace(/ <.*$/, ''));
  assert.ok(commands.length >= 2, `found ${String(commands.length)} commands`);
  const open = commands.filter((command) => !rules.some((rule) => ruleMatches(rule, command)));
  assert.deepEqual([...new Set(open)], []);
});

test('#110: the factory skill step 8 agrees with pr-description', () => {
  const { text } = fileStepWith(FACTORY_SKILL, 'Open the PR.', '## Work a ticket');
  assert.doesNotMatch(text, /task 4c|#110/, 'step 8 no longer waits for task 4c');
  assert.match(text, /Skip its push step/);
  assert.match(text, /`## Over budget`/);
  assert.match(text, /`## Decisions I made`/);
});
