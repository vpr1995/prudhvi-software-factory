// Tests for pre-pr and implement-feature (design factory-daily-run 8, task 4b, #109).
// R-13, R-17, R-18, R-27 (part): the skills use the router, the round and findings commands, and
// the guarded push. Each check reads one step of the skill, so that deleting the step fails the test.
// The tests read the real repository files. They call no `gh` and no network.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { COMMAND_NAMES } from '../scripts/factory.mjs';
import { routing } from '../scripts/lib/factory-routing.mjs';
import { readRepositoryFile } from '../scripts/lib/fs-io.mjs';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const TOP_STEP = /^\d+\. /;

/** @returns {boolean} True when the Bash allow rule matches the command (same rule as factory-skill-paths). */
function ruleMatches(rule, command) {
  const inner = /^Bash\((.*)\)$/.exec(rule)?.[1];
  if (inner === undefined) return false;
  if (inner.endsWith(':*')) {
    const prefix = inner.slice(0, -2);
    return command === prefix || command.startsWith(`${prefix} `);
  }
  if (!inner.includes('*')) return command === inner;
  const [head, tail] = inner.split('*');
  return command.startsWith(head) && command.endsWith(tail);
}

const PRE_PR = '.claude/skills/pre-pr/SKILL.md';
const IMPLEMENT = '.claude/skills/implement-feature/SKILL.md';
const FACTORY_CALL = 'node tooling/repo-checks/scripts/factory.mjs';

/** @returns {string[]} The numbered steps of the `## Steps` section of a skill file, each with its sub-lines. */
function stepsOfFile(file) {
  const lines = readRepositoryFile(ROOT, file).split('\n');
  const start = lines.indexOf('## Steps');
  assert.notEqual(start, -1, `${file} has a "## Steps" section`);
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  const steps = [];
  for (const line of lines.slice(start + 1, end === -1 ? undefined : end)) {
    if (TOP_STEP.test(line)) steps.push(line);
    else if (steps.length > 0) steps[steps.length - 1] += `\n${line}`;
  }
  return steps;
}

/** @returns {{ number: number, text: string }} The first step of the file that has the text (number from 1). */
function fileStepWith(file, needle) {
  const steps = stepsOfFile(file);
  const index = steps.findIndex((step) => step.includes(needle));
  assert.notEqual(index, -1, `a step of ${file} has "${needle}"`);
  return { number: index + 1, text: steps[index] };
}

const prePrText = () => readRepositoryFile(ROOT, PRE_PR);
const factoryText = () => readRepositoryFile(ROOT, '.claude/skills/factory/SKILL.md');

test('#109 R-27: pre-pr starts each round with the round command, and the script gives the round number', () => {
  const { text } = fileStepWith(PRE_PR, `${FACTORY_CALL} round`);
  assert.match(text, /factory\.mjs round \[<n>\] start --new/);
  assert.match(text, /factory\.mjs round \[<n>\] start`/);
  assert.match(text, /prints `round <k>`/);
  assert.match(text, /not count rounds yourself/i);
  assert.ok(COMMAND_NAMES.has('round'), 'factory.mjs has the command round');
});

test('#109 R-27: pre-pr writes findings only with the findings command: add, set and list', () => {
  const add = fileStepWith(PRE_PR, `${FACTORY_CALL} findings [<n>] add`);
  assert.match(add.text, /severity \| file:line \| bug class \| reason/);
  const set = fileStepWith(PRE_PR, `${FACTORY_CALL} findings [<n>] set`);
  assert.match(set.text, /set <id> fixed/);
  assert.match(set.text, /set <id> rejected/);
  assert.match(prePrText(), /factory\.mjs findings \[<n>\] list/);
  assert.ok(COMMAND_NAMES.has('findings'), 'factory.mjs has the command findings');
  assert.ok(add.number < set.number, 'findings are added before they are set');
});

test('#109 R-27: pre-pr and implement-feature name no state folder, no mkdir and no state file', () => {
  for (const file of [PRE_PR, IMPLEMENT]) {
    const text = readRepositoryFile(ROOT, file);
    assert.doesNotMatch(text, /\.claude\/(?:factory|state)/, `${file} names a state folder`);
    assert.doesNotMatch(text, /mkdir/, `${file} makes a folder`);
    assert.doesNotMatch(text, /round-<n>\.start|findings\.md/, `${file} names a state file`);
  }
});

test('#109 R-27: pre-pr takes the ticket from the request or the branch name, else the script picks the ad hoc folder', () => {
  const { text } = fileStepWith(PRE_PR, 'git branch --show-current');
  assert.match(text, /number in the request/);
  assert.match(text, /No number: no ticket/);
  assert.match(prePrText(), /ad hoc folder that the script picks/);
  assert.match(prePrText(), /`\[<n>\]` means/);
});

test('#109 R-18: pre-pr runs the router with factory.mjs route <n>, and uses base, passes and models of its output', () => {
  const { text } = fileStepWith(PRE_PR, `${FACTORY_CALL} route <n>`);
  assert.ok(COMMAND_NAMES.has('route'), 'factory.mjs has the command route');
  for (const field of ['`base`', '`passes`', '`docOnly`', '`model`']) {
    assert.ok(text.includes(field), `the route step names ${field}`);
  }
  assert.match(text, /Run only the passes of `passes`/);
});

test('#109 R-18: pre-pr names each pass of the routing table, and spawns it with the model of the router output', () => {
  const { text } = fileStepWith(PRE_PR, 'Spawn each agent');
  for (const name of Object.keys(routing.passes)) {
    assert.ok(text.includes(`\`${name}\``), `the pass step names the pass ${name}`);
  }
  assert.match(
    text,
    /Spawn each agent with the Agent tool and its `model` set to the `model` of that pass/,
  );
  assert.match(text, /`session`: set no `model`/);
  assert.match(text, /Never use a model from your own choice/);
  assert.match(text, /bug-hunt[^\n]*`Model: <model>`/);
});

test('#109 R-18: a doc-only diff runs only the spec pass', () => {
  const { text } = fileStepWith(PRE_PR, '`docOnly` is true');
  assert.match(text, /`docOnly` is true/);
  assert.match(text, /only the `spec-reviewer` pass/);
  assert.match(text, /No other pass/);
  assert.match(text, /no `code-review`/);
});

test('#109 R-17: the push step runs the guard with factory.mjs push, gives one fix round, then a hard stop', () => {
  const { text } = fileStepWith(PRE_PR, `${FACTORY_CALL} push <n>`);
  const guard = text.indexOf('test guard');
  const push = text.indexOf(`${FACTORY_CALL} push <n>`);
  const fixRound = text.indexOf('one fix round');
  const stop = text.indexOf(`${FACTORY_CALL} hardstop <n>`);
  assert.ok(COMMAND_NAMES.has('push') && COMMAND_NAMES.has('hardstop'), 'the commands exist');
  assert.ok(
    guard !== -1 && push !== -1 && fixRound !== -1 && stop !== -1,
    'the step has each part',
  );
  assert.ok(guard < fixRound && fixRound < stop, 'order: test guard, one fix round, hard stop');
  assert.match(text, /no PR labels/);
  assert.match(text, /"test guard finding stays"/);
  assert.match(text, /"script hard stop"/);
  assert.ok(
    factoryText().includes('- "test guard finding stays"'),
    'the factory skill has the phrase',
  );
  assert.ok(factoryText().includes('- "script hard stop"'), 'the factory skill has the phrase');
});

test('#109 R-17: "check config changed" does not block the push, goes to the router and the PR body', () => {
  const { text } = fileStepWith(PRE_PR, `${FACTORY_CALL} push <n>`);
  const line = text.split('\n').find((entry) => entry.includes('check config changed'));
  assert.ok(line !== undefined, 'the push step names the finding');
  assert.match(line, /not block/);
  assert.match(line, /factory\.mjs route <n>/);
  assert.match(line, /risk:high/);
  assert.match(line, /PR body/);
});

test('#109 R-17: the rounds, the last commit and the push come in this order, and no step pushes with git', () => {
  const steps = stepsOfFile(PRE_PR);
  const at = (needle) => steps.findIndex((step) => step.includes(needle));
  const round = at(`${FACTORY_CALL} round`);
  const commit = at('git commit');
  const push = at(`${FACTORY_CALL} push <n>`);
  assert.ok(round !== -1 && round < commit && commit < push, 'round, commit, push');
  assert.equal(push, steps.length - 1, 'the push is the last step');
  for (const file of [PRE_PR, IMPLEMENT]) {
    assert.doesNotMatch(readRepositoryFile(ROOT, file), /git push/, `${file} runs git push`);
  }
});

test('#109 R-13: pre-pr keeps the limit of 3 rounds, and a go-to step points to the round start', () => {
  const steps = stepsOfFile(PRE_PR);
  const start = steps.findIndex((step) => step.includes(`${FACTORY_CALL} round`)) + 1;
  const loop = fileStepWith(PRE_PR, 'round < 3');
  const targets = [...loop.text.matchAll(/go to step (\d+)/g)].map((match) => Number(match[1]));
  assert.ok(targets.includes(start), `the round loop goes to step ${String(start)}`);
  for (const [, target] of prePrText().matchAll(/go to step (\d+)/g)) {
    assert.ok(Number(target) >= 1 && Number(target) <= steps.length, `step ${target} exists`);
  }
  const last = fileStepWith(PRE_PR, 'Do not start round 4');
  assert.match(last.text, /open Important findings remain after round 3/);
  assert.match(last.text, /Ask the human/);
});

test('#109: implement-feature hands the review to pre-pr, then the push to factory.mjs push, in the same step numbers as before', () => {
  const steps = stepsOfFile(IMPLEMENT);
  const commit = steps.findIndex((step) => step.includes('git commit'));
  const review = steps.findIndex((step) => step.includes('`pre-pr`'));
  const text = steps[review];
  assert.ok(commit !== -1 && commit < review, 'the commit comes before pre-pr');
  assert.match(text, /needs a clean tree/);
  const push = text.indexOf(`${FACTORY_CALL} push <n>`);
  assert.ok(push > text.indexOf('`pre-pr`'), 'the push command follows the pre-pr call');
  assert.match(text.slice(push), /test guard first/);
  assert.match(text, /Never push with git/);
  assert.equal(review + 1, 10, '/factory skips steps 10, 11 and 12 of implement-feature');
  assert.equal(steps.length, 12, '/factory skips steps 10, 11 and 12: no step after 12');
  assert.match(steps[10], /`pr-description`/);
});

test('#109: implement-feature names the branch with the ticket number', () => {
  const { text } = fileStepWith(IMPLEMENT, 'git checkout -b');
  assert.match(text, /<type>\/<n>-<short-kebab>/);
});

test('#109: each node command of pre-pr and implement-feature has an allow rule in .claude/settings.json', () => {
  const rules = JSON.parse(readRepositoryFile(ROOT, '.claude/settings.json')).permissions.allow;
  const commands = [PRE_PR, IMPLEMENT]
    .flatMap((file) => [...readRepositoryFile(ROOT, file).matchAll(/`([^`]+)`/g)])
    .map((match) => match[1])
    .filter((span) => /^(?:node tooling|git status)/.test(span))
    .map((span) => span.replace(/ <.*$/, ''));
  assert.ok(commands.length >= 8, `found ${String(commands.length)} commands`);
  const open = commands.filter((command) => !rules.some((rule) => ruleMatches(rule, command)));
  assert.deepEqual([...new Set(open)], []);
});

test('#109 R-27: a later round starts at the sha of the previous round start, not at HEAD~1', () => {
  const start = fileStepWith(PRE_PR, `${FACTORY_CALL} round`).text;
  assert.match(start, /git log -1 --format=%H/);
  assert.match(start, /`round <k> start`/);
  const { text } = fileStepWith(PRE_PR, 'Round 2 or 3: Range');
  assert.match(text, /Range = `<sha>\.\.HEAD`/);
  assert.doesNotMatch(prePrText(), /HEAD~1/);
});

test('#109 R-27: findings rows go on stdin from a mktemp file that the factory settings already allow, with no heredoc', () => {
  const { text } = fileStepWith(PRE_PR, `${FACTORY_CALL} findings [<n>] add`);
  assert.match(text, /`mktemp \/tmp\/factory-pr\.XXXXXX`/);
  assert.match(text, /Write tool/);
  assert.match(text, /< "<file>"/);
  assert.match(text, /`rm \/tmp\/factory-pr\.<suffix>`, also when the command fails/);
  assert.doesNotMatch(readRepositoryFile(ROOT, PRE_PR), /<<-?'?[A-Z]+/);
  for (const rule of ['Bash(mktemp /tmp/factory-pr.XXXXXX)', 'Bash(rm /tmp/factory-pr.*)']) {
    assert.ok(factoryText().includes(`"${rule}"`), `the factory setup block has ${rule}`);
  }
  assert.ok(ruleMatches('Bash(mktemp /tmp/factory-pr.XXXXXX)', 'mktemp /tmp/factory-pr.XXXXXX'));
  assert.ok(ruleMatches('Bash(rm /tmp/factory-pr.*)', 'rm /tmp/factory-pr.<suffix>'));
});

test('#109: implement-feature skips the push step of pr-description when a ticket exists', () => {
  const { text } = fileStepWith(IMPLEMENT, 'Run the `pr-description` skill');
  assert.match(text, /With a ticket, skip its push step: step 10 pushed/);
});
