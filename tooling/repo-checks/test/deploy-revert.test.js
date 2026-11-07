// Tests for scripts/deploy-revert.mjs: when a failed smoke test should open a revert PR.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  decide,
  findSmokeFailures,
  isRevert,
  outputLines,
  revertBody,
  revertTitle,
} from '../scripts/deploy-revert.mjs';

const job = (name, conclusion, steps = []) => ({ name, conclusion, steps });
const step = (name, conclusion) => ({ name, conclusion });

test('findSmokeFailures lists the projects whose smoke test failed', () => {
  const jobs = [
    job('plan', 'success', [step('Plan the deploy', 'success')]),
    job('cloudflare @scope/a', 'failure', [
      step('Wrangler deploy', 'success'),
      step('Smoke test', 'failure'),
    ]),
    job('cloudflare @scope/b', 'success', [step('Smoke test', 'success')]),
  ];
  assert.deepEqual(findSmokeFailures(jobs), ['@scope/a']);
});

test('a failure before the smoke test is not a smoke failure', () => {
  const jobs = [
    job('cloudflare @scope/a', 'failure', [
      step('Rush build', 'failure'),
      step('Smoke test', 'skipped'),
    ]),
    job('cloudflare @scope/b', 'failure', [
      step('Wrangler deploy', 'failure'),
      step('Smoke test', 'skipped'),
    ]),
  ];
  assert.deepEqual(findSmokeFailures(jobs), []);
});

test('isRevert is true for a revert commit and for the merge of a revert branch', () => {
  assert.equal(isRevert('Revert "feat(x): add y"'), true);
  assert.equal(isRevert('revert: feat(x): add y'), true);
  assert.equal(isRevert('Merge pull request #80 from vpr1995/revert/abc1234'), true);
  assert.equal(isRevert('Merge pull request #75 from vpr1995/revert-74-feat-x'), true);
  assert.equal(
    isRevert('Merge pull request #75 from vpr1995/fix/x', '\nRevert "feat(x): y"\n'),
    true,
  );
  assert.equal(isRevert('feat(x): revert the default'), false);
  assert.equal(
    isRevert('Merge pull request #73 from vpr1995/feat/deploy-workflow-cloudflare'),
    false,
  );
});

test('revertTitle uses the pull request title of a merge commit', () => {
  assert.equal(revertTitle('feat(x): add y', ''), 'revert: feat(x): add y');
  assert.equal(
    revertTitle('Merge pull request #74 from vpr1995/feat/a', '\nfeat(x): add y\n'),
    'revert: feat(x): add y',
  );
  assert.equal(
    revertTitle('Merge pull request #74 from vpr1995/feat/a', ''),
    'revert: Merge pull request #74 from vpr1995/feat/a',
  );
});

test('decide: revert when a smoke test failed and the commit is not a revert', () => {
  const jobs = [job('cloudflare @scope/a', 'failure', [step('Smoke test', 'failure')])];
  assert.deepEqual(decide('feat(x): add y', jobs), {
    revert: true,
    projects: ['@scope/a'],
    reason: '',
  });
});

test('decide: never revert a revert', () => {
  const jobs = [job('cloudflare @scope/a', 'failure', [step('Smoke test', 'failure')])];
  const result = decide('Revert "feat(x): add y"', jobs);
  assert.equal(result.revert, false);
  assert.match(result.reason, /never revert a revert/);
});

test('decide: no revert without a smoke failure', () => {
  const jobs = [job('cloudflare @scope/a', 'failure', [step('Rush build', 'failure')])];
  const result = decide('feat(x): add y', jobs);
  assert.equal(result.revert, false);
  assert.match(result.reason, /no smoke test failed/);
});

test('outputLines gives key=value lines, with the projects joined by commas', () => {
  assert.deepEqual(outputLines({ revert: true, projects: ['@a/b', '@a/c'], reason: '' }), [
    'revert=true',
    'projects=@a/b,@a/c',
    'reason=',
  ]);
});

test('revertBody names the commit, the projects and the run, and tells the owner what to do', () => {
  const body = revertBody({
    sha: 'abc1234def',
    projects: ['@scope/a'],
    runUrl: 'https://github.com/o/r/actions/runs/1',
  });
  assert.match(body, /abc1234def/);
  assert.match(body, /@scope\/a/);
  assert.match(body, /actions\/runs\/1/);
  assert.match(body, /Close and reopen this PR/);
});

const SCRIPT = fileURLToPath(new URL('../scripts/deploy-revert.mjs', import.meta.url));

/** Run the script with arguments and optional stdin. */
function cli(args, input = '') {
  // CI sets GITHUB_OUTPUT, and the script then writes there. An empty value makes it print to stdout.
  const env = { GITHUB_OUTPUT: '' };
  return spawnSync(process.execPath, [SCRIPT, ...args], { input, encoding: 'utf8', env });
}

test('the decide mode reads the jobs on stdin and prints the output lines', () => {
  const jobs = JSON.stringify({
    jobs: [job('cloudflare @scope/a', 'failure', [step('Smoke test', 'failure')])],
  });
  const result = cli(['decide', 'feat(x): add y'], jobs);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'revert=true\nprojects=@scope/a\nreason=\n');
});

test('the title and body modes print the text, and an unknown mode exits with 1', () => {
  assert.equal(cli(['title', 'feat(x): add y', '']).stdout, 'revert: feat(x): add y\n');
  assert.match(cli(['body', 'abc1234', '@scope/a', 'https://example.com/run']).stdout, /abc1234/);
  const unknown = cli(['nope']);
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /Usage/);
});
