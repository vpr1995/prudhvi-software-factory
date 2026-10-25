// Tests for the gate fixtures script: the runner logic, the report and the fixture list. They run
// no real fixture: no worktree is made and no gate runs. The CLI cases only use paths that stop
// before the worktree (--list, bad arguments, and a CI-only selection). The node_modules links of
// the worktree are tested on a small folder layout in the temp folder, not on a real worktree.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { allFixtures } from '../lib/gate-fixtures-list.mjs';
import { renderReport, renderTable } from '../lib/gate-fixtures-report.mjs';
import {
  evaluate,
  exitCodeFor,
  expectedText,
  fill,
  parseFixtureArguments,
  redact,
  RESULT,
  resolveRun,
  runAll,
  runFixture,
  selectFixtures,
  summarize,
} from '../lib/gate-fixtures-run.mjs';
import { copyPackageBuilds, linkNodeModules } from '../lib/gate-fixtures-worktree.mjs';

import { exec, GATES, REPOSITORY } from './harness.js';

const CLI = path.join(GATES, 'gate-fixtures.mjs');
const PRETTIER = path.join(
  REPOSITORY,
  'common',
  'autoinstallers',
  'rush-lint-staged',
  'node_modules',
  '.bin',
  'prettier',
);
const VARS = {
  main: '/repo',
  worktree: '/tmp/gate-fixtures-abc/worktree',
  sample: '/w/s',
  base: 'abc',
};
const OK = { started: true, timedOut: false };

const bad = (extra = {}) => ({
  id: 'bad',
  row: 'Row',
  change: 'change',
  gate: 'gate',
  setup: [{ type: 'write', path: 'a.txt', text: 'x' }],
  run: { program: 'tool', args: ['{worktree}/a.txt'] },
  expected: { status: 'nonzero', match: [/no-explicit-any/, /a\.txt/] },
  ...extra,
});

/** A fake executor that records its calls and answers with one outcome. */
function fakeContext(outcome, calls = []) {
  return {
    variables: VARS,
    reset: () => calls.push('reset'),
    apply: (step) => calls.push(`apply:${step.type}`),
    run: (call) => {
      calls.push(`run:${call.program} ${call.args.join(' ')}`);
      return outcome;
    },
  };
}

describe('fill and resolveRun', () => {
  it('replaces the four markers and leaves other braces alone', () => {
    assert.equal(
      fill('{main}:{worktree}:{sample}:{base}:{other}', VARS),
      `/repo:${VARS.worktree}:/w/s:abc:{other}`,
    );
  });

  it('builds the call: program, args, cwd, env and the stdin text from a function', () => {
    const call = resolveRun(
      {
        program: '{main}/x.sh',
        args: ['--root', '{worktree}'],
        cwd: 'sample',
        env: { CLAUDE_PROJECT_DIR: '{worktree}' },
        input: (variables) => `in:${variables.base}`,
        timeoutMs: 5,
      },
      VARS,
    );
    assert.deepEqual(call, {
      program: '/repo/x.sh',
      args: ['--root', VARS.worktree],
      cwd: '/w/s',
      input: 'in:abc',
      env: { CLAUDE_PROJECT_DIR: VARS.worktree },
      timeoutMs: 5,
    });
  });

  it('uses the worktree as the default folder', () => {
    assert.equal(resolveRun({ program: 'x' }, VARS).cwd, VARS.worktree);
  });
});

describe('redact', () => {
  it('hides the worktree path, the repo path and a secret-like value', () => {
    const key = ['AKIA', 'QWERTYUIOPASDFGH'].join('');
    const text = `${VARS.worktree}/a.ts at /repo/b.ts holds ${key}`;
    assert.equal(redact(text, VARS), '<worktree>/a.ts at <repo>/b.ts holds <secret>');
  });

  it('hides the home folder as ~, after the repo path, so a repo in the home folder stays <repo>', () => {
    const home = '/Users/someone';
    const variables = { ...VARS, main: `${home}/repo` };
    assert.equal(
      redact(`${home}/repo/a.ts and ${home}/.npm/x`, variables, home),
      '<repo>/a.ts and ~/.npm/x',
    );
    assert.equal(redact(`${home}/x`, variables, `${home}/`), '~/x');
    assert.equal(redact(`${home}else/x`, variables, home), `${home}else/x`);
    assert.equal(redact('/x', variables, '/'), '/x');
  });

  it('uses the home folder of this machine by default', () => {
    const home = os.homedir();
    assert.ok(home.length > 1, 'the test needs a home folder');
    assert.equal(redact(`${home}/cache/x`, VARS), '~/cache/x');
  });

  it('makes one line and cuts a long text', () => {
    assert.equal(redact('a\n  b\t c', VARS), 'a b c');
    const cut = redact('x'.repeat(500), VARS);
    assert.equal(cut.length, 110);
    assert.ok(cut.endsWith('...'));
  });
});

describe('evaluate', () => {
  const outcome = (extra) => ({ status: 1, stdout: '', stderr: '', ...OK, ...extra });

  it('accepts a rejection with the right code and all patterns', () => {
    const judged = evaluate(bad(), outcome({ stderr: 'a.txt\n  1:1 error no-explicit-any' }), VARS);
    assert.equal(judged.result, RESULT.REJECTED);
    assert.match(judged.detail, /no-explicit-any/);
  });

  it('accepts a string expectation when the output contains it', () => {
    const fixture = bad({ expected: { status: 'nonzero', match: ['a.txt'] } });
    assert.equal(evaluate(fixture, outcome({ stderr: 'in a.txt' }), VARS).result, RESULT.REJECTED);
    assert.equal(evaluate(fixture, outcome({ stderr: 'b.txt' }), VARS).result, RESULT.NOT_REJECTED);
  });

  it('fails when the gate exits 0', () => {
    const judged = evaluate(bad(), outcome({ status: 0, stdout: 'a.txt no-explicit-any' }), VARS);
    assert.equal(judged.result, RESULT.NOT_REJECTED);
    assert.match(judged.detail, /exit 0, expected nonzero/);
  });

  it('fails when the code is right and the text is not (a wrong reason is not a rejection)', () => {
    const judged = evaluate(bad(), outcome({ stderr: 'a.txt parsing error' }), VARS);
    assert.equal(judged.result, RESULT.NOT_REJECTED);
    assert.match(judged.detail, /no match for \/no-explicit-any\//);
  });

  it('needs the exact code when the fixture names one', () => {
    const fixture = bad({ expected: { status: 2, match: [/x/] } });
    assert.equal(
      evaluate(fixture, outcome({ status: 1, stderr: 'x' }), VARS).result,
      RESULT.NOT_REJECTED,
    );
    assert.equal(
      evaluate(fixture, outcome({ status: 2, stderr: 'x' }), VARS).result,
      RESULT.REJECTED,
    );
  });

  it('fails when the tool did not start, and when it timed out', () => {
    assert.match(
      evaluate(bad(), outcome({ started: false, status: 127 }), VARS).detail,
      /did not start/,
    );
    assert.match(
      evaluate(bad(), outcome({ timedOut: true, status: 124 }), VARS).detail,
      /timed out/,
    );
  });

  it('accepts a control with exit 0 and rejects a control with another code', () => {
    const control = bad({ control: true, expected: undefined });
    assert.equal(evaluate(control, outcome({ status: 0 }), VARS).result, RESULT.ACCEPTED);
    assert.equal(evaluate(control, outcome({ status: 1 }), VARS).result, RESULT.CONTROL_REJECTED);
    assert.equal(
      evaluate(control, outcome({ started: false }), VARS).result,
      RESULT.CONTROL_REJECTED,
    );
  });

  it('needs the sentinel of a control, and fails a control whose output has an absent text', () => {
    const control = bad({
      control: true,
      expected: { status: 0, match: [/^ran$/m], absent: [/BLOCKED/] },
    });
    const accepted = evaluate(control, outcome({ status: 0, stdout: 'x\nran\n' }), VARS);
    assert.equal(accepted.result, RESULT.ACCEPTED);
    assert.equal(accepted.detail, 'exit 0: ran');
    const silent = evaluate(control, outcome({ status: 0, stdout: 'x' }), VARS);
    assert.equal(silent.result, RESULT.CONTROL_REJECTED);
    assert.match(silent.detail, /no match for \/\^ran\$\/m/);
    const blocked = evaluate(control, outcome({ status: 0, stderr: 'BLOCKED\nran' }), VARS);
    assert.equal(blocked.result, RESULT.CONTROL_REJECTED);
    assert.match(blocked.detail, /the text has \/BLOCKED\//);
    assert.equal(
      evaluate(control, outcome({ status: 2, stdout: 'ran' }), VARS).result,
      RESULT.CONTROL_REJECTED,
    );
  });

  it('applies an absent text to a rejection too', () => {
    const fixture = bad({ expected: { status: 'nonzero', match: [/x/], absent: [/parse error/] } });
    assert.equal(evaluate(fixture, outcome({ stderr: 'x' }), VARS).result, RESULT.REJECTED);
    assert.equal(
      evaluate(fixture, outcome({ stderr: 'x parse error' }), VARS).result,
      RESULT.NOT_REJECTED,
    );
  });

  it('fails a fixture with no expected result', () => {
    assert.equal(
      evaluate(bad({ expected: undefined }), outcome(), VARS).result,
      RESULT.NOT_REJECTED,
    );
  });
});

describe('expectedText', () => {
  it('shows the code and the first pattern', () => {
    assert.equal(expectedText(bad()), 'exit nonzero, /no-explicit-any/');
    assert.equal(expectedText(bad({ expected: { status: 2, match: [] } })), 'exit 2');
    assert.equal(expectedText(bad({ control: true, expected: undefined })), 'exit 0');
    assert.equal(
      expectedText(bad({ control: true, expected: { status: 0, match: [/ran/] } })),
      'exit 0, /ran/',
    );
    assert.equal(expectedText(bad({ expected: undefined })), 'CI only');
  });
});

describe('runFixture', () => {
  it('resets first, applies the steps in order, then runs the gate', () => {
    const calls = [];
    const row = runFixture(
      bad(),
      fakeContext({ status: 1, stdout: '', stderr: 'a.txt no-explicit-any', ...OK }, calls),
    );
    assert.deepEqual(calls, ['reset', 'apply:write', `run:tool ${VARS.worktree}/a.txt`]);
    assert.equal(row.result, RESULT.REJECTED);
    assert.equal(row.id, 'bad');
    assert.equal(row.expected, 'exit nonzero, /no-explicit-any/');
  });

  it('turns a setup error into a FAIL row and does not run the gate', () => {
    const calls = [];
    const context = fakeContext({ status: 1, stdout: '', stderr: '', ...OK }, calls);
    context.apply = () => {
      throw new Error(`setup: text not found in ${VARS.worktree}/x`);
    };
    const row = runFixture(bad(), context);
    assert.equal(row.result, RESULT.SETUP_FAILED);
    assert.equal(row.detail, 'setup: text not found in <worktree>/x');
    assert.deepEqual(calls, ['reset']);
  });

  it('fails a fixture with no run spec', () => {
    const row = runFixture(
      bad({ run: undefined }),
      fakeContext({ status: 1, stdout: '', stderr: '', ...OK }),
    );
    assert.equal(row.result, RESULT.SETUP_FAILED);
  });

  it('marks a fixture that needs another rule in the gate column', () => {
    const row = runFixture(
      bad({ needs: 'A' }),
      fakeContext({ status: 0, stdout: '', stderr: '', ...OK }),
    );
    assert.equal(row.gate, 'gate (needs agent A)');
    assert.equal(row.result, RESULT.NOT_REJECTED);
  });
});

describe('selectFixtures and runAll', () => {
  const list = [
    bad({ id: 'a' }),
    bad({ id: 'b', slow: true }),
    bad({ id: 'c', ciLater: true }),
    bad({ id: 'd' }),
  ];
  const skips = (plan) => plan.map((entry) => [entry.fixture.id, entry.skip]);

  it('runs fast fixtures, skips slow ones, and lists CI rows as CI later', () => {
    assert.deepEqual(skips(selectFixtures(list, { only: [], slow: false })), [
      ['a', null],
      ['b', RESULT.SLOW],
      ['c', RESULT.CI_LATER],
      ['d', null],
    ]);
  });

  it('runs slow fixtures with the flag, but never a CI-only row', () => {
    assert.deepEqual(skips(selectFixtures(list, { only: [], slow: true })), [
      ['a', null],
      ['b', null],
      ['c', RESULT.CI_LATER],
      ['d', null],
    ]);
  });

  it('keeps the report order and selects with --only', () => {
    assert.deepEqual(skips(selectFixtures(list, { only: ['d', 'a'], slow: false })), [
      ['a', null],
      ['d', null],
    ]);
  });

  it('throws for an unknown id, so a typo cannot pass as a green run', () => {
    assert.throws(
      () => selectFixtures(list, { only: ['a', 'nope'], slow: false }),
      /unknown fixture id: nope/,
    );
  });

  it('gives one row for each plan entry, calls onRow, and runs only the selected ones', () => {
    const calls = [];
    const seen = [];
    const rows = runAll(selectFixtures(list, { only: [], slow: false }), {
      ...fakeContext({ status: 1, stdout: '', stderr: 'a.txt no-explicit-any', ...OK }, calls),
      onRow: (row) => seen.push(row.id),
    });
    assert.deepEqual(
      rows.map((row) => [row.id, row.result]),
      [
        ['a', RESULT.REJECTED],
        ['b', RESULT.SLOW],
        ['c', RESULT.CI_LATER],
        ['d', RESULT.REJECTED],
      ],
    );
    assert.deepEqual(seen, ['a', 'b', 'c', 'd']);
    assert.equal(calls.filter((call) => call === 'reset').length, 2);
    assert.match(rows[1].detail, /--slow/);
  });
});

describe('summarize and exitCodeFor', () => {
  const rows = (...results) => results.map((result) => ({ result }));

  it('counts pass, fail and skip', () => {
    assert.deepEqual(
      summarize(
        rows(RESULT.REJECTED, RESULT.ACCEPTED, RESULT.NOT_REJECTED, RESULT.SLOW, RESULT.CI_LATER),
      ),
      { pass: 2, fail: 1, skip: 2 },
    );
  });

  it('exits 0 when all that ran passed, also when some were skipped', () => {
    assert.equal(
      exitCodeFor(rows(RESULT.REJECTED, RESULT.ACCEPTED, RESULT.SLOW, RESULT.CI_LATER)),
      0,
    );
    assert.equal(exitCodeFor([]), 0);
  });

  it('exits 1 for each kind of failure', () => {
    for (const result of [RESULT.NOT_REJECTED, RESULT.CONTROL_REJECTED, RESULT.SETUP_FAILED]) {
      assert.equal(exitCodeFor(rows(RESULT.REJECTED, result)), 1, result);
    }
  });
});

describe('parseFixtureArguments', () => {
  it('has safe defaults', () => {
    assert.deepEqual(parseFixtureArguments([]), {
      only: [],
      slow: false,
      keep: false,
      list: false,
      help: false,
      report: '',
      error: '',
    });
  });

  it('reads every flag', () => {
    const options = parseFixtureArguments([
      '--only',
      'a,b,',
      '--slow',
      '--keep',
      '--list',
      '--report',
      'out.md',
    ]);
    assert.deepEqual(
      [options.only, options.slow, options.keep, options.list, options.report],
      [['a', 'b'], true, true, true, 'out.md'],
    );
    assert.equal(parseFixtureArguments(['-h']).help, true);
  });

  it('reports a missing value and an unknown flag', () => {
    assert.match(parseFixtureArguments(['--only']).error, /--only needs a value/);
    assert.match(parseFixtureArguments(['--report', '--slow']).error, /--report needs a value/);
    assert.match(parseFixtureArguments(['--bogus']).error, /unknown argument: --bogus/);
  });
});

describe('report', () => {
  it('renders a table the way Prettier pads it', () => {
    assert.equal(
      renderTable(
        ['Id', 'Result'],
        [
          ['a', 'PASS'],
          ['long-id', 'x'],
        ],
      ),
      [
        '| Id      | Result |',
        '| ------- | ------ |',
        '| a       | PASS   |',
        '| long-id | x      |',
      ].join('\n'),
    );
  });

  const rows = [
    {
      id: 'lint-any',
      row: 'Add `any`',
      change: 'a function with `any`',
      gate: 'ESLint',
      expected: 'exit nonzero, /no-explicit-any/',
      result: RESULT.REJECTED,
      detail: 'exit 1: 1:22 error Unexpected any | more',
    },
    {
      id: 'ci-lint',
      row: 'CI half',
      change: 'not planted: no CI yet',
      gate: 'CI lint',
      expected: 'CI only',
      result: RESULT.CI_LATER,
      detail: 'only CI can prove this row (CI is not set up yet)',
    },
  ];
  const meta = {
    date: '2026-10-25',
    commit: 'abc1234',
    dirtyGates: [],
    mode: 'all fixtures',
    slow: false,
    rows,
  };

  it('states the date, commit, run mode and the summary', () => {
    const text = renderReport(meta);
    assert.ok(text.startsWith('# Gate fixtures\n'));
    assert.ok(text.endsWith('\n') && !text.endsWith('\n\n'));
    assert.match(text, /^- Date: 2026-10-25$/m);
    assert.match(text, /^- Commit: `abc1234`$/m);
    assert.match(text, /^- Gate files of the main tree with an uncommitted change: none$/m);
    assert.match(text, /^- Run: all fixtures, slow fixtures not included$/m);
    assert.match(text, /^- Summary: 1 pass, 0 fail, 1 skip$/m);
  });

  it('lists uncommitted gate files and the slow flag', () => {
    const text = renderReport({
      ...meta,
      dirtyGates: ['a/b.mjs', 'c.json'],
      slow: true,
      mode: '--only x',
    });
    assert.match(text, /: `a\/b\.mjs`, `c\.json`$/m);
    assert.match(text, /^- Run: --only x, slow fixtures included$/m);
  });

  it('writes one table row for each fixture, all with the same width, with the pipe escaped', () => {
    const lines = renderReport(meta)
      .split('\n')
      .filter((line) => line.startsWith('|'));
    assert.equal(lines.length, 2 + rows.length);
    assert.equal(new Set(lines.map((line) => line.length)).size, 1);
    assert.ok(lines[2].includes('`exit 1: 1:22 error Unexpected any \\| more`'));
    assert.ok(lines[3].includes('SKIP (CI, later)'));
  });

  it('passes the Prettier check that step h of the local gates runs on Markdown', () => {
    assert.ok(fs.existsSync(PRETTIER), `Prettier is missing at ${PRETTIER}. Run rush install.`);
    const result = exec(
      PRETTIER,
      ['--check', '--stdin-filepath', 'docs/standards/gate-fixtures.md'],
      {
        cwd: REPOSITORY,
        input: renderReport(meta),
      },
    );
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  });
});

describe('the fixture list', () => {
  const fixtures = allFixtures();
  const byId = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  const stepTypes = new Set([
    'write',
    'append',
    'replace',
    'remove',
    'removeTracked',
    'addDependency',
    'stage',
    'commit',
    'sessionBase',
    'rewind',
    'resetTo',
  ]);

  it('has unique ids in kebab case', () => {
    assert.equal(byId.size, fixtures.length);
    for (const fixture of fixtures) {
      assert.match(fixture.id, /^[a-z0-9-]+$/, fixture.id);
      assert.ok(!fixture.id.startsWith('-') && !fixture.id.endsWith('-'), fixture.id);
      assert.ok(!fixture.id.includes('--'), fixture.id);
    }
  });

  it('describes every fixture: plan row, change and gate', () => {
    for (const fixture of fixtures) {
      for (const key of ['row', 'change', 'gate']) {
        assert.ok(
          typeof fixture[key] === 'string' && fixture[key].length > 0,
          `${fixture.id}: ${key}`,
        );
      }
    }
  });

  it('gives each runnable fixture a gate command and an expectation with text to match', () => {
    for (const fixture of fixtures.filter((entry) => entry.ciLater !== true)) {
      assert.ok(
        fixture.run !== undefined && typeof fixture.run.program === 'string',
        `${fixture.id}: run`,
      );
      if (fixture.control !== true) {
        assert.ok(
          fixture.expected !== undefined && fixture.expected.match.length > 0,
          `${fixture.id}: expected`,
        );
      }
    }
  });

  it('uses only step types that the worktree module knows', () => {
    for (const fixture of fixtures) {
      for (const step of fixture.setup ?? []) {
        assert.ok(stepTypes.has(step.type), `${fixture.id}: ${step.type}`);
      }
    }
  });

  it('does not run a CI-only row, and a CI-only row needs no command', () => {
    const ciRows = fixtures.filter((fixture) => fixture.ciLater === true);
    assert.ok(ciRows.length >= 10);
    for (const fixture of ciRows) {
      assert.equal(fixture.run, undefined, fixture.id);
    }
  });

  it('has a control for each tool family', () => {
    const controls = new Set(
      fixtures.filter((fixture) => fixture.control === true).map((fixture) => fixture.id),
    );
    for (const id of [
      'lint-control',
      'opengrep-control',
      'anti-skip-control',
      'test-control',
      'guard-control',
      'deps-control',
      'commitlint-control',
      'nag-control',
    ]) {
      assert.ok(controls.has(id), id);
    }
  });

  it('gives the anti-skip, deps and guard controls a sentinel, so a gate that did nothing fails', () => {
    const sentinel = (id) => byId.get(id)?.expected?.match ?? [];
    assert.ok(
      sentinel('anti-skip-control').some((pattern) =>
        pattern.test('anti-skip: pass (1 changed files scanned)'),
      ),
    );
    assert.ok(
      !sentinel('anti-skip-control').some((pattern) =>
        pattern.test('anti-skip: pass (0 changed files scanned)'),
      ),
    );
    assert.ok(
      sentinel('deps-control').some((pattern) =>
        pattern.test('typosquat-check: pass (1 new dependency names)'),
      ),
    );
    assert.ok(
      !sentinel('deps-control').some((pattern) =>
        pattern.test('typosquat-check: pass (0 new dependency names)'),
      ),
    );
    const guard = byId.get('guard-control');
    assert.ok(guard?.expected?.match.some((pattern) => pattern.test('gate-fixtures-control-ran')));
    assert.ok(guard?.expected?.absent?.some((pattern) => pattern.test('BLOCKED by guard-bash')));
    assert.ok(guard?.run?.args?.some((word) => word.includes('echo gate-fixtures-control-ran')));
  });

  it('gives no control a rejection expectation (a control expects exit 0)', () => {
    for (const fixture of fixtures.filter((entry) => entry.control === true)) {
      assert.ok(
        fixture.expected === undefined || fixture.expected.status === 0,
        `${fixture.id}: expected`,
      );
    }
  });

  it('plants changes that only the new rules of agents A, B and C reject, and matches their text', () => {
    const copy = byId.get('guard-copy-into-state');
    const input = JSON.parse(copy.run.input(VARS));
    assert.equal(input.tool_input.command, 'ditto /tmp/x .claude/state');
    assert.ok(
      copy.expected.match.some((pattern) => pattern.test('ditto writes into .claude/state')),
    );

    const noAssertion = byId.get('anti-skip-no-assertion');
    assert.deepEqual(noAssertion.expected.match, [/\[test-without-assertion\]/]);
    const planted = noAssertion.setup.find((step) => step.type === 'write');
    assert.match(planted.text, /\{\n {2}const fs = require\('fs'\);\n {2}run\(\);\n\}\);/);
    assert.doesNotMatch(planted.text, /\b(?:expect|assert)\b/);

    const verify = byId.get('require-verify-no-state');
    assert.deepEqual(verify.expected.match, [/needs a passing verify/]);
    assert.deepEqual(verify.setup[0], { type: 'resetTo', ref: 'origin/main' });
    assert.equal(verify.setup.at(-1).type, 'commit');

    const reset = byId.get('push-after-reset');
    assert.deepEqual(
      reset.setup.map((step) => step.type),
      ['resetTo', 'replace', 'commit', 'sessionBase', 'rewind', 'write', 'commit'],
    );
    assert.match(reset.setup[1].path, /tsconfig[^/]*\.json$/);
    assert.ok(reset.expected.match.some((pattern) => String(pattern).includes('rewound past')));
    assert.ok(!reset.expected.match.some((pattern) => String(pattern).includes('differs from')));
  });

  it('marks the fixtures of the new rules of agents A, B and C, and no other', () => {
    const needs = Object.fromEntries(
      fixtures
        .filter((fixture) => fixture.needs !== undefined)
        .map((fixture) => [fixture.id, fixture.needs]),
    );
    assert.deepEqual(needs, {
      'anti-skip-no-assertion': 'C',
      'guard-copy-into-state': 'B',
      'push-after-reset': 'A',
    });
  });

  it('covers each row of plan section 11 that a local gate can prove', () => {
    const required = [
      'lint-any',
      'lint-test-only',
      'lint-test-skip',
      'lint-disable-no-description',
      'lint-ts-ignore',
      'protect-ci-workflow',
      'protect-eslint-config',
      'lint-web-imports-api',
      'lint-eval',
      'lint-dangerous-html',
      'opengrep-eval',
      'opengrep-dangerous-html',
      'opengrep-sql-string',
      'commitlint-bad-message',
      'nag-iam-wildcard',
      'check-gates-test-deletion',
      'block-secrets-aws-key',
      'gitleaks-staged-aws-key',
      'guard-no-verify',
      'guard-force-push',
      'guard-cdk-deploy',
      'nag-s3-bucket',
      'lint-process-env-in-route',
      'stop-failing-test',
      'stop-it-skip',
      'stop-lower-threshold',
      'require-verify-no-state',
      'lint-naming-variable',
      'lint-naming-type',
      'lint-naming-filename',
      'lint-enum',
      'lint-default-export',
      'lint-todo-without-link',
      'push-lock-with-tarball',
      'deps-typosquat-name',
      'deps-git-url-spec',
      'guard-gates-base',
      'push-rush-json-removal',
    ];
    for (const id of required) {
      assert.ok(byId.has(id), id);
    }
  });

  it('marks the cdk-nag fixtures as slow and no other', () => {
    assert.deepEqual(
      fixtures.filter((fixture) => fixture.slow === true).map((fixture) => fixture.id),
      ['nag-iam-wildcard', 'nag-s3-bucket', 'nag-control'],
    );
  });

  it('holds no bad literal in the fixture sources (they are built with join)', () => {
    const bad = [
      ['it.', 'skip('],
      ['it.', 'only('],
      ['eslint-', 'disable'],
      ['@ts-', 'ignore'],
      ['dangerously', 'SetInnerHTML'],
    ].map((parts) => parts.join(''));
    for (const name of fs
      .readdirSync(path.join(GATES, 'lib'))
      .filter((file) => file.startsWith('gate-fixtures-'))) {
      const text = fs.readFileSync(path.join(GATES, 'lib', name), 'utf8');
      for (const literal of bad) {
        assert.ok(!text.includes(literal), `${name} holds ${literal}`);
      }
      assert.ok(!/AKIA[0-9A-Z]{16}/.test(text), `${name} holds an AWS key`);
    }
  });
});

/**
 * Makes a main tree and a worktree in a temp folder, in the layout of the repo: a project whose
 * node_modules has a real .bin folder, an external package link, a workspace link and an @scope
 * folder, and a package with a dist folder. The worktree has the same project and package folders.
 */
function makeLayout() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-fixtures-links-'));
  const main = path.join(base, 'main');
  const root = path.join(base, 'worktree');
  const modules = path.join(main, 'projects', 'app', 'node_modules');
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  write(path.join(main, 'common', 'temp', 'store', 'ext', 'index.js'), 'ext\n');
  write(path.join(main, 'common', 'temp', 'store', 'scoped-ext', 'index.js'), 'scoped\n');
  write(path.join(main, 'packages', 'lib', 'package.json'), '{}\n');
  write(path.join(main, 'packages', 'lib', 'dist', 'index.js'), 'built\n');
  write(path.join(main, 'packages', 'lib', 'node_modules', 'dep', 'index.js'), 'dep\n');
  write(path.join(modules, '.bin', 'tool'), '#!/bin/sh\n');
  fs.mkdirSync(path.join(modules, '@scope'));
  fs.symlinkSync('../../../common/temp/store/ext', path.join(modules, 'ext'));
  fs.symlinkSync('../../../packages/lib', path.join(modules, 'lib'));
  fs.symlinkSync('../../../../packages/lib', path.join(modules, '@scope', 'lib'));
  fs.symlinkSync(
    '../../../../common/temp/store/scoped-ext',
    path.join(modules, '@scope', 'scoped-ext'),
  );
  write(path.join(root, 'projects', 'app', 'package.json'), '{}\n');
  write(path.join(root, 'packages', 'lib', 'package.json'), '{}\n');
  return { base, main, root };
}

describe('the node_modules links of the worktree', () => {
  /** Runs a check on a fresh layout with the links made, then removes the layout. */
  function withLinks(check) {
    const layout = makeLayout();
    try {
      const made = [];
      linkNodeModules(layout.main, layout.root, made);
      copyPackageBuilds(layout.main, layout.root, made);
      check({
        ...layout,
        made,
        modules: path.join(layout.root, 'projects', 'app', 'node_modules'),
      });
    } finally {
      fs.rmSync(layout.base, { recursive: true, force: true });
    }
  }
  const real = (target) => fs.realpathSync(target);
  const isLink = (target) => fs.lstatSync(target).isSymbolicLink();

  it('makes a real node_modules folder for each project and package, and records it', () => {
    withLinks(({ root, made, modules }) => {
      assert.ok(fs.lstatSync(modules).isDirectory());
      assert.ok(!isLink(modules));
      const packageModules = path.join(root, 'packages', 'lib', 'node_modules');
      assert.ok(!isLink(packageModules));
      assert.ok(made.includes(modules));
      assert.ok(made.includes(packageModules));
    });
  });

  it('points a workspace link to the same package in the worktree', () => {
    withLinks(({ root, main, modules }) => {
      assert.ok(isLink(path.join(modules, 'lib')));
      assert.equal(real(path.join(modules, 'lib')), real(path.join(root, 'packages', 'lib')));
      assert.notEqual(real(path.join(modules, 'lib')), real(path.join(main, 'packages', 'lib')));
    });
  });

  it('points an external package to the main tree', () => {
    withLinks(({ main, root, modules }) => {
      assert.ok(isLink(path.join(modules, 'ext')));
      assert.equal(
        real(path.join(modules, 'ext')),
        real(path.join(main, 'common', 'temp', 'store', 'ext')),
      );
      const dependency = path.join(root, 'packages', 'lib', 'node_modules', 'dep');
      assert.equal(
        real(dependency),
        real(path.join(main, 'packages', 'lib', 'node_modules', 'dep')),
      );
    });
  });

  it('makes an @scope folder a real folder with one link for each package in it', () => {
    withLinks(({ main, root, modules }) => {
      const scope = path.join(modules, '@scope');
      assert.ok(fs.lstatSync(scope).isDirectory());
      assert.ok(!isLink(scope));
      assert.deepEqual(fs.readdirSync(scope).sort(), ['lib', 'scoped-ext']);
      assert.equal(real(path.join(scope, 'lib')), real(path.join(root, 'packages', 'lib')));
      assert.equal(
        real(path.join(scope, 'scoped-ext')),
        real(path.join(main, 'common', 'temp', 'store', 'scoped-ext')),
      );
    });
  });

  it('points .bin (a real folder in the main tree) to the main tree, not to itself', () => {
    withLinks(({ main, modules }) => {
      const bin = path.join(modules, '.bin');
      assert.ok(isLink(bin));
      assert.equal(real(bin), real(path.join(main, 'projects', 'app', 'node_modules', '.bin')));
      assert.equal(fs.readFileSync(path.join(bin, 'tool'), 'utf8'), '#!/bin/sh\n');
    });
  });

  it('copies the dist folder of a package as a real folder, and records it', () => {
    withLinks(({ root, made }) => {
      const output = path.join(root, 'packages', 'lib', 'dist');
      assert.ok(!isLink(output));
      assert.ok(fs.lstatSync(output).isDirectory());
      assert.equal(fs.readFileSync(path.join(output, 'index.js'), 'utf8'), 'built\n');
      assert.equal(real(output), path.join(real(root), 'packages', 'lib', 'dist'));
      assert.ok(made.includes(output));
    });
  });
});

describe('gate-fixtures.mjs', () => {
  it('prints the ids with --list', () => {
    const result = exec(process.execPath, [CLI, '--list'], { cwd: REPOSITORY });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      result.stdout.trim().split('\n'),
      allFixtures().map((fixture) => fixture.id),
    );
  });

  it('exits 2 for an unknown fixture id, a bad flag and a missing value', () => {
    for (const args of [['--only', 'nope'], ['--bogus'], ['--only']]) {
      const result = exec(process.execPath, [CLI, ...args], { cwd: REPOSITORY });
      assert.equal(result.status, 2, args.join(' '));
    }
  });

  it('prints help', () => {
    const result = exec(process.execPath, [CLI, '--help'], { cwd: REPOSITORY });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /throwaway git worktree/);
  });

  it('lists a CI-only row as SKIP, makes no worktree, and does not write the report with --only', () => {
    const before = exec('git', ['worktree', 'list'], { cwd: REPOSITORY }).stdout;
    const result = exec(process.execPath, [CLI, '--only', 'ci-lint'], { cwd: REPOSITORY });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /SKIP \(CI, later\)\s+ci-lint/);
    assert.match(result.stdout, /- Summary: 0 pass, 0 fail, 1 skip/);
    assert.equal(exec('git', ['worktree', 'list'], { cwd: REPOSITORY }).stdout, before);
  });
});
