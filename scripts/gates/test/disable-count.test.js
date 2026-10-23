// Tests for the disable-count check of check-gates.mjs (lib/disable-count.mjs). The CLI runs for
// real against temp git repos. Marker text is joined at run time so that this file does not hold
// the markers as plain text.
import assert from 'node:assert/strict';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  judgeMarkers,
  LINT_EXCEPTION_LABEL,
  MARKER_RULE_IDS,
  markerOf,
  markerRules,
} from '../lib/disable-count.mjs';

import { exec, GATES, makeRepository } from './harness.js';

const CLI = path.join(GATES, 'check-gates.mjs');
const join = (...parts) => parts.join('');

/** One file for each kind of marker: [path, text, rule id]. The marker is on line 1. */
const MARKERS = [
  [
    'src/eslint.ts',
    `${join('// eslint', '-disable-next-line no-console')}\nrun();\n`,
    'eslint-disable',
  ],
  ['src/ignore.ts', `${join('// @ts', '-ignore')}\nconst a = 1;\n`, 'ts-directive'],
  ['src/expect.ts', `${join('// @ts', '-expect-error')}\nconst a = 1;\n`, 'ts-directive'],
  ['src/nocheck.ts', `${join('// @ts', '-nocheck')}\nconst a = 1;\n`, 'ts-directive'],
  ['src/coverage.ts', `${join('/* v8', ' ignore next */')}\nrun();\n`, 'coverage-ignore'],
  ['src/semgrep.ts', `${join('// nosem', 'grep: rule')}\nrun();\n`, 'security-suppress'],
  ['api/noqa.py', `import os  ${join('# no', 'qa')}\n`, 'py-noqa'],
  ['api/type.py', `x: int = "a"  ${join('# type', ': ignore')}\n`, 'py-type-ignore'],
  ['api/nosec.py', `y = 1  ${join('# nos', 'ec')}\n`, 'security-suppress'],
  ['api/pragma.py', `if x:  ${join('# pragma', ': no cover')}\n    pass\n`, 'py-pragma-no-cover'],
  ['api/pylint.py', `z = 1  ${join('# pylint', ': disable=x')}\n`, 'py-pylint-disable'],
  ['go/nolint.go', `var x = 1 ${join('//', 'nolint')}\n`, 'go-nolint'],
  ['go/gosec.go', `${join('// #nos', 'ec')}\nvar y = 1\n`, 'security-suppress'],
  ['ci/leaks.yml', `key: value # ${join('gitleaks', ':allow')}\n`, 'security-suppress'],
  [
    'ci/checkov.yml',
    `# ${join('checkov', ':skip=CKV_AWS_1:reason')}\nkey: value\n`,
    'security-suppress',
  ],
  [
    'lib/ack.ts',
    `${join('Validations', '.of(role).acknowledge({ id: "X", reason: "r" });')}\n`,
    'cdk-nag-acknowledge',
  ],
  [
    'lib/chain.ts',
    `Validations.of(role)\n  ${join('.ack', 'nowledge({ id: "X", reason: "r" });')}\n`,
    'cdk-nag-acknowledge',
  ],
  [
    'lib/nag.ts',
    `${join('NagSuppressions', '.addResourceSuppressions(a, []);')}\n`,
    'cdk-nag-acknowledge',
  ],
];

const lines = (count) =>
  Array.from({ length: count }, (_, index) => `line ${String(index)}\n`).join('');

describe('disable-count helpers', () => {
  it('uses only anti-skip rules that exist', () => {
    const ids = new Set(markerRules().map((rule) => rule.id));
    for (const id of MARKER_RULE_IDS) {
      assert.ok(ids.has(id), id);
    }
  });

  it('recognizes every marker kind with the rule list', () => {
    const rules = markerRules();
    for (const [file, text, rule] of MARKERS) {
      const found = text.split('\n').map((line) => markerOf(file, line, rules));
      assert.deepEqual(
        found.filter((entry) => entry !== null),
        [rule],
        file,
      );
    }
  });

  it('does not count a marker in a string, in the wrong language or in plain code', () => {
    const rules = markerRules();
    assert.equal(
      markerOf('src/a.ts', `const text = '${join('eslint', '-disable')}';`, rules),
      null,
    );
    assert.equal(markerOf('src/a.ts', `x = 1  ${join('# no', 'qa')}`, rules), null);
    assert.equal(markerOf('api/a.py', `value = 1  ${join('// @ts', '-ignore')}`, rules), null);
    assert.equal(markerOf('src/a.ts', 'const acknowledged = true;', rules), null);
    assert.equal(markerOf('src/a.ts', 'acknowledge(this)', rules), null);
  });

  it('judges the net count', () => {
    const marker = { file: 'a.ts', line: 1, rule: 'eslint-disable' };
    assert.equal(judgeMarkers({ added: [], removed: [marker] }, []).status, 'pass');
    assert.equal(judgeMarkers({ added: [marker], removed: [marker] }, []).status, 'pass');
    assert.equal(judgeMarkers({ added: [marker, marker], removed: [marker] }, []).status, 'fail');
    assert.equal(
      judgeMarkers({ added: [marker], removed: [] }, [LINT_EXCEPTION_LABEL]).status,
      'warn',
    );
    assert.equal(judgeMarkers({ added: [marker], removed: [] }, ['test-removal']).status, 'fail');
  });
});

describe('check-gates disable-count', () => {
  let repository;

  beforeEach(() => {
    repository = makeRepository({
      'src/clean.ts': 'export const clean = 1;\n',
      'src/old-marker.ts': `${join('// eslint', '-disable-next-line no-console')}\nconsole.log(1);\n`,
      'src/old-marker-two.ts': `${join('// @ts', '-ignore')}\nconst a = 1;\n`,
      'docs/guide.md': lines(3),
    });
    repository.git('checkout', '-q', '-b', 'feature');
  });
  afterEach(() => repository.remove());

  const commit = (message = 'change') => {
    repository.git('add', '-A');
    repository.git('commit', '-q', '-m', message);
  };
  const check = (args = []) => {
    const result = exec('node', [
      CLI,
      '--root',
      repository.root,
      '--base',
      'main',
      '--head',
      'feature',
      '--json',
      ...args,
    ]);
    const report = JSON.parse(result.stdout);
    return { result, check: report.checks.find((entry) => entry.name === 'disable-count'), report };
  };

  it('passes when no marker is added', () => {
    repository.write('src/new.ts', 'export const a = 1;\n');
    commit();
    const { result, check: found } = check();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(found.status, 'pass');
    assert.deepEqual(found.details.added, []);
  });

  it('fails for each kind of marker and reports file:line and rule', () => {
    for (const [file, text] of MARKERS) {
      repository.write(file, text);
    }
    commit();
    const { result, check: found } = check();
    assert.equal(result.status, 1, result.stderr);
    assert.equal(found.status, 'fail');
    assert.equal(found.details.net, MARKERS.length);
    for (const [file, , rule] of MARKERS) {
      const line = file === 'lib/chain.ts' ? 2 : 1;
      assert.ok(
        found.details.added.some(
          (entry) => entry.file === file && entry.line === line && entry.rule === rule,
        ),
        `${file} ${rule}: ${JSON.stringify(found.details.added)}`,
      );
    }
    assert.match(found.summary, /^net \+18 \(18 added, 0 removed\. Added: /);
  });

  it('reports the line of a marker added in the middle of a file', () => {
    repository.write(
      'src/clean.ts',
      `export const clean = 1;\n${join('// @ts', '-ignore')}\nexport const b = 2;\n`,
    );
    commit();
    const { check: found } = check();
    assert.deepEqual(found.details.added, [
      { file: 'src/clean.ts', line: 2, rule: 'ts-directive' },
    ]);
  });

  it('allows a net increase with the lint-exception label and exits 0', () => {
    repository.write('src/ignore.ts', MARKERS[1][1]);
    commit();
    const { result, check: found } = check(['--labels', `risk:low, ${LINT_EXCEPTION_LABEL}`]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(found.status, 'warn');
    assert.match(found.summary, /Allowed by the "lint-exception" label/);
  });

  it('does not accept another label in place of lint-exception', () => {
    repository.write('src/ignore.ts', MARKERS[1][1]);
    commit();
    assert.equal(check(['--labels', 'test-removal,large-pr']).result.status, 1);
  });

  it('passes when the PR removes as many markers as it adds', () => {
    repository.write('src/old-marker.ts', 'console.log(1);\n');
    repository.write('src/ignore.ts', MARKERS[1][1]);
    commit();
    const { result, check: found } = check();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(found.status, 'pass');
    assert.equal(found.details.net, 0);
    assert.equal(found.details.added.length, 1);
    assert.equal(found.details.removed.length, 1);
    assert.match(found.summary, /^net 0 \(1 added, 1 removed/);
  });

  it('passes when the PR only removes markers', () => {
    repository.write('src/old-marker.ts', 'console.log(1);\n');
    repository.git('rm', '-q', 'src/old-marker-two.ts');
    commit();
    const { result, check: found } = check();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(found.details.net, -2);
    assert.match(found.summary, /^no disable marker added \(2 removed\)/);
  });

  it('does not count a renamed file that holds markers', () => {
    repository.git('mv', 'src/old-marker.ts', 'src/moved-marker.ts');
    commit();
    const { result, check: found } = check();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(found.details.added, []);
    assert.deepEqual(found.details.removed, []);
  });

  it('does not count a marker that moves inside a file', () => {
    repository.write(
      'src/old-marker.ts',
      `console.log(0);\n${join('// eslint', '-disable-next-line no-console')}\nconsole.log(1);\n`,
    );
    commit();
    const { check: found } = check();
    assert.equal(found.details.net, 0);
    assert.equal(found.status, 'pass');
  });

  it('does not count markers in Markdown, in strings or in the wrong language', () => {
    repository.write('docs/guide.md', `${lines(3)}Use ${join('// @ts', '-ignore')} never.\n`);
    repository.write('src/text.ts', `const text = '${join('eslint', '-disable')}';\n`);
    repository.write('api/wrong.py', `value = 1  ${join('// @ts', '-ignore')}\n`);
    commit();
    const { result, check: found } = check();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(found.details.added, []);
  });

  it('does not count markers that only the base branch changed', () => {
    repository.write('src/new.ts', 'export const a = 1;\n');
    commit();
    repository.git('checkout', '-q', 'main');
    repository.write('src/base-only.ts', `${join('// @ts', '-ignore')}\nconst a = 1;\n`);
    commit('base moves');
    repository.git('checkout', '-q', 'feature');
    const { result, check: found } = check();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(found.details.added, []);
  });

  it('prints the check in the human summary', () => {
    repository.write('src/ignore.ts', MARKERS[1][1]);
    commit();
    const result = exec('node', [
      CLI,
      '--root',
      repository.root,
      '--base',
      'main',
      '--head',
      'feature',
    ]);
    assert.equal(result.status, 1);
    assert.match(
      result.stdout,
      /^FAIL disable-count: net \+1 \(1 added, 0 removed\. Added: src\/ignore\.ts:1 \[ts-directive\]\)/m,
    );
  });
});
