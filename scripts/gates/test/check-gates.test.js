// Tests for check-gates.mjs and lib/pr-size.mjs. The CLI runs for real against temp git repos.
import assert from 'node:assert/strict';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { parseLabels } from '../check-gates.mjs';
import {
  isSizeExcluded,
  judgeSize,
  parseNumstat,
  SIZE_FAIL_LINES,
  SIZE_WARN_LINES,
} from '../lib/pr-size.mjs';

import { exec, GATES, makeRepository } from './harness.js';

const CLI = path.join(GATES, 'check-gates.mjs');

/**
 * Makes a text with a number of lines.
 *
 * @param {number} count - Number of lines.
 * @param {string} [prefix] - Text at the start of each line.
 * @returns {string} The text.
 */
const lines = (count, prefix = 'line') =>
  Array.from({ length: count }, (_, index) => `${prefix} ${String(index)}\n`).join('');

describe('pr-size helpers', () => {
  it('parses numstat records, renames and binary files', () => {
    const output = [
      '3\t1\tsrc/a.ts',
      '-\t-\timage.png',
      '0\t0\t',
      'old/name.ts',
      'new/name.ts',
      '5\t0\twith space.ts',
      '',
    ].join('\0');
    assert.deepEqual(parseNumstat(output), [
      { path: 'src/a.ts', added: 3, deleted: 1 },
      { path: 'image.png', added: 0, deleted: 0 },
      { path: 'new/name.ts', added: 0, deleted: 0 },
      { path: 'with space.ts', added: 5, deleted: 0 },
    ]);
  });

  it('returns no file for empty output', () => {
    assert.deepEqual(parseNumstat(''), []);
  });

  it('excludes lockfiles, generated code and snapshots at any depth', () => {
    for (const file of [
      'common/config/rush/pnpm-lock.yaml',
      'projects/p/src/api-py/uv.lock',
      'projects/p/src/api-go/go.sum',
      'package-lock.json',
      'projects/p/src/api-py/src/p_api/generated/models.py',
      'projects/p/src/api-go/internal/gen/api.gen.go',
      'projects/p/lib/__snapshots__/stack.test.ts.snap',
      'projects/p/test/stack.snap',
    ]) {
      assert.equal(isSizeExcluded(file), true, file);
    }
  });

  it('counts source, tests, docs and look-alike paths', () => {
    for (const file of [
      'projects/p/src/api/handler.ts',
      'projects/p/src/api/handler.test.ts',
      'docs/guides/api.md',
      'projects/p/src/api-go/internal/gen.go',
      'projects/p/src/generated-docs.md',
      'projects/p/snapshot.ts',
    ]) {
      assert.equal(isSizeExcluded(file), false, file);
    }
  });

  it('parses labels', () => {
    assert.deepEqual(parseLabels('large-pr, risk:high ,,test-removal'), [
      'large-pr',
      'risk:high',
      'test-removal',
    ]);
    assert.deepEqual(parseLabels(''), []);
  });

  it('uses the limits that the owner set: warn above 2000, fail above 10000', () => {
    assert.equal(SIZE_WARN_LINES, 2000);
    assert.equal(SIZE_FAIL_LINES, 10000);
  });

  it('judges the size limits', () => {
    assert.equal(judgeSize(0, []).status, 'pass');
    assert.equal(judgeSize(SIZE_WARN_LINES, []).status, 'pass');
    assert.equal(judgeSize(SIZE_WARN_LINES + 1, []).status, 'warn');
    assert.equal(judgeSize(SIZE_FAIL_LINES, []).status, 'warn');
    assert.equal(judgeSize(SIZE_FAIL_LINES + 1, []).status, 'fail');
    assert.equal(judgeSize(SIZE_FAIL_LINES + 1, ['large-pr']).status, 'warn');
    assert.equal(judgeSize(SIZE_FAIL_LINES + 1, ['risk:high']).status, 'fail');
  });
});

describe('check-gates', () => {
  let repository;

  beforeEach(() => {
    repository = makeRepository({
      'tooling/eslint-config/index.js': 'export default [];\n',
      'packages/a/package.json': `${JSON.stringify(
        { name: '@t/a', version: '1.0.0', scripts: { '_phase:test': 'vitest run' } },
        null,
        2,
      )}\n`,
      'docs/guide.md': lines(5, 'doc'),
      'src/old.ts': lines(10, 'old'),
    });
    repository.git('checkout', '-q', '-b', 'feature');
  });
  afterEach(() => repository.remove());

  const commit = (message = 'change') => {
    repository.git('add', '-A');
    repository.git('commit', '-q', '-m', message);
  };
  const check = (args = [], base = 'main', head = 'feature') =>
    exec('node', [CLI, '--root', repository.root, '--base', base, '--head', head, ...args]);
  const checkJson = (args = []) => {
    const result = check([...args, '--json']);
    return { result, report: JSON.parse(result.stdout) };
  };
  const byName = (report, name) => report.checks.find((entry) => entry.name === name);

  describe('gate files', () => {
    it('reports riskHigh false when no gate file changes', () => {
      repository.write('src/new.ts', 'export const a = 1;\n');
      commit();
      const { result, report } = checkJson();
      assert.equal(result.status, 0, result.stderr);
      assert.equal(report.riskHigh, false);
      assert.deepEqual(byName(report, 'gate-files').details.files, []);
      assert.equal(report.failed, false);
    });

    it('reports riskHigh true and the files, and still exits 0', () => {
      repository.write('tooling/eslint-config/index.js', 'export default [1];\n');
      repository.write('.github/workflows/ci.yml', 'name: ci\n');
      repository.write('src/new.ts', 'export const a = 1;\n');
      commit();
      const { result, report } = checkJson();
      assert.equal(result.status, 0, result.stderr);
      assert.equal(report.riskHigh, true);
      assert.equal(report.failed, false);
      assert.deepEqual(byName(report, 'gate-files').details.files, [
        '.github/workflows/ci.yml',
        'tooling/eslint-config/index.js',
      ]);
      assert.equal(byName(report, 'gate-files').status, 'pass');
    });

    it('prints the files in the human summary', () => {
      repository.write('rush.json', '{}\n');
      commit();
      const result = check();
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /gate-files: risk:high\. 1 gate file changed: rush\.json$/m);
      assert.match(result.stdout, /check-gates: pass \(riskHigh: true\)/);
    });

    it('names at most 8 gate files in the summary and all of them in the JSON', () => {
      for (let index = 0; index < 11; index += 1) {
        repository.write(`tooling/rule-${String(index).padStart(2, '0')}.js`, 'x\n');
      }
      commit();
      const result = check();
      assert.match(result.stdout, /11 gate files changed: .*rule-07\.js, and 3 more$/m);
      assert.doesNotMatch(result.stdout, /rule-08/);
      assert.equal(byName(checkJson().report, 'gate-files').details.files.length, 11);
    });

    it('reports a deleted gate file', () => {
      repository.git('rm', '-q', 'tooling/eslint-config/index.js');
      commit();
      const { report } = checkJson();
      assert.equal(report.riskHigh, true);
      assert.deepEqual(byName(report, 'gate-files').details.files, [
        'tooling/eslint-config/index.js',
      ]);
    });

    it('reports a changed _phase script in a package.json', () => {
      repository.write(
        'packages/a/package.json',
        `${JSON.stringify({ name: '@t/a', version: '1.0.0', scripts: { '_phase:test': 'echo ok' } }, null, 2)}\n`,
      );
      commit();
      const { report } = checkJson();
      assert.equal(report.riskHigh, true);
      assert.deepEqual(byName(report, 'gate-files').details.changes, [
        { file: 'packages/a/package.json', change: 'phase-script', detail: '_phase:test changed' },
      ]);
    });

    it('does not report a package.json change outside the _phase scripts', () => {
      repository.write(
        'packages/a/package.json',
        `${JSON.stringify({ name: '@t/a', version: '1.1.0', scripts: { '_phase:test': 'vitest run' } }, null, 2)}\n`,
      );
      commit();
      assert.equal(checkJson().report.riskHigh, false);
    });

    it('ignores gate files that only the base branch changed', () => {
      repository.write('src/new.ts', 'export const a = 1;\n');
      commit();
      repository.git('checkout', '-q', 'main');
      repository.write('tooling/eslint-config/index.js', 'export default [2];\n');
      commit('base moves');
      repository.git('checkout', '-q', 'feature');
      const { report } = checkJson();
      assert.equal(report.riskHigh, false);
      assert.deepEqual(byName(report, 'pr-size').details.lines, 1);
    });
  });

  describe('PR size', () => {
    const sizeOf = (report) => byName(report, 'pr-size');

    it('passes at the warning limit', () => {
      repository.write('src/big.ts', lines(SIZE_WARN_LINES));
      commit();
      const { result, report } = checkJson();
      assert.equal(result.status, 0, result.stderr);
      assert.equal(sizeOf(report).status, 'pass');
      assert.equal(sizeOf(report).details.lines, SIZE_WARN_LINES);
    });

    it('warns above 2000 lines and exits 0', () => {
      repository.write('src/big.ts', lines(SIZE_WARN_LINES + 1));
      commit();
      const { result, report } = checkJson();
      assert.equal(result.status, 0, result.stderr);
      assert.equal(sizeOf(report).status, 'warn');
      assert.equal(report.failed, false);
    });

    it('warns at 10000 lines', () => {
      repository.write('src/big.ts', lines(SIZE_FAIL_LINES));
      commit();
      const { result, report } = checkJson();
      assert.equal(result.status, 0, result.stderr);
      assert.equal(sizeOf(report).status, 'warn');
    });

    it('fails above 10000 lines and exits 1', () => {
      repository.write('src/big.ts', lines(SIZE_FAIL_LINES + 1));
      commit();
      const { result, report } = checkJson();
      assert.equal(result.status, 1, result.stderr);
      assert.equal(sizeOf(report).status, 'fail');
      assert.equal(report.failed, true);
      assert.match(result.stderr, /FAILED/);
    });

    it('prints FAIL in the human summary', () => {
      repository.write('src/big.ts', lines(SIZE_FAIL_LINES + 1));
      commit();
      const result = check();
      assert.equal(result.status, 1);
      assert.match(result.stdout, /^FAIL pr-size: 10001 changed lines, above 10000/m);
      assert.match(result.stdout, /check-gates: FAILED/);
    });

    it('allows more than 10000 lines with the large-pr label', () => {
      repository.write('src/big.ts', lines(SIZE_FAIL_LINES + 1));
      commit();
      const { result, report } = checkJson(['--labels', 'risk:low, large-pr']);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(sizeOf(report).status, 'warn');
      assert.equal(report.failed, false);
    });

    it('does not accept another label in place of large-pr', () => {
      repository.write('src/big.ts', lines(SIZE_FAIL_LINES + 1));
      commit();
      assert.equal(check(['--labels', 'test-removal,risk:high']).status, 1);
    });

    it('counts added and deleted lines', () => {
      repository.write('src/old.ts', lines(7, 'new'));
      repository.write('docs/guide.md', lines(5, 'doc') + lines(3, 'more'));
      commit();
      // src/old.ts: 10 old lines deleted, 7 new lines added. docs/guide.md: 3 lines added.
      assert.equal(sizeOf(checkJson().report).details.lines, 10 + 7 + 3);
    });

    it('does not count lockfiles, generated code and snapshots', () => {
      repository.write('common/config/rush/pnpm-lock.yaml', lines(2000));
      repository.write('projects/p/src/api-py/src/p_api/generated/models.py', lines(2000));
      repository.write('projects/p/src/api-go/internal/gen/api.gen.go', lines(2000));
      repository.write('projects/p/lib/__snapshots__/stack.test.ts.snap', lines(2000));
      repository.write('src/real.ts', lines(12));
      commit();
      const { result, report } = checkJson();
      assert.equal(result.status, 0, result.stderr);
      const size = sizeOf(report);
      assert.equal(size.status, 'pass');
      assert.equal(size.details.lines, 12);
      assert.equal(size.details.files, 1);
      assert.deepEqual(size.details.excludedFiles.sort(), [
        'common/config/rush/pnpm-lock.yaml',
        'projects/p/lib/__snapshots__/stack.test.ts.snap',
        'projects/p/src/api-go/internal/gen/api.gen.go',
        'projects/p/src/api-py/src/p_api/generated/models.py',
      ]);
    });

    it('does not count a pure rename, and counts a rename with edits', () => {
      repository.write('src/big.ts', lines(600));
      commit('add');
      repository.git('checkout', '-q', '-B', 'main', 'feature');
      repository.git('checkout', '-q', '-b', 'move');
      repository.git('mv', 'src/big.ts', 'src/moved.ts');
      commit('rename');
      const movedLines = () => sizeOf(JSON.parse(check(['--json'], 'main', 'move').stdout));
      assert.equal(movedLines().details.lines, 0);
      repository.write('src/moved.ts', `${lines(600)}extra\n`);
      commit('edit');
      assert.equal(movedLines().details.lines, 1);
    });

    it('counts a binary file as zero lines', () => {
      repository.write('docs/logo.bin', `\0${lines(5000)}`);
      commit();
      assert.equal(sizeOf(checkJson().report).details.lines, 0);
    });

    it('does not count commits that only the base has', () => {
      repository.write('src/small.ts', lines(3));
      commit();
      repository.git('checkout', '-q', 'main');
      repository.write('src/base-only.ts', lines(900));
      commit('base moves');
      repository.git('checkout', '-q', 'feature');
      assert.equal(sizeOf(checkJson().report).details.lines, 3);
    });

    it('reports an empty range as a pass', () => {
      const { result, report } = checkJson();
      assert.equal(result.status, 0, result.stderr);
      assert.equal(sizeOf(report).details.lines, 0);
      assert.equal(report.riskHigh, false);
    });
  });

  describe('output and usage', () => {
    it('prints the machine object with checks, riskHigh and failed', () => {
      repository.write('src/new.ts', 'export const a = 1;\n');
      commit();
      const { report } = checkJson();
      assert.deepEqual(Object.keys(report).sort(), ['checks', 'failed', 'riskHigh']);
      assert.deepEqual(
        report.checks.map((entry) => entry.name),
        ['gate-files', 'pr-size', 'disable-count', 'test-deletion', 'test-location'],
      );
      for (const entry of report.checks) {
        assert.ok(['pass', 'warn', 'fail'].includes(entry.status));
        assert.equal(typeof entry.summary, 'string');
      }
    });

    it('prints only JSON on stdout with --json', () => {
      const result = check(['--json']);
      assert.doesNotThrow(() => JSON.parse(result.stdout));
    });

    it('exits 2 for a revision that git does not know', () => {
      const result = check([], 'main', 'no-such-branch');
      assert.equal(result.status, 2);
      assert.match(result.stderr, /Bad revision "no-such-branch"/);
      assert.equal(result.stdout, '');
    });

    it('exits 2 for a revision that looks like a git option', () => {
      const result = check([], '--output=/tmp/should-not-exist', 'feature');
      assert.equal(result.status, 2);
      assert.match(result.stderr, /must not start with "-"/);
    });

    it('exits 2 when --head is missing', () => {
      const result = exec('node', [CLI, '--root', repository.root, '--base', 'main']);
      assert.equal(result.status, 2);
      assert.match(result.stderr, /--base and --head are required/);
    });

    it('exits 2 when a flag has no value', () => {
      const result = exec('node', [CLI, '--root', repository.root, '--base']);
      assert.equal(result.status, 2);
      assert.match(result.stderr, /missing value for --base/);
    });

    it('exits 2 for an unknown argument', () => {
      const result = check(['--nope']);
      assert.equal(result.status, 2);
      assert.match(result.stderr, /unknown argument: --nope/);
    });

    it('prints the help text with --help', () => {
      const result = exec('node', [CLI, '--help']);
      assert.equal(result.status, 0);
      assert.match(result.stdout, /Usage:/);
      assert.match(
        result.stdout,
        /Above 2000: warning\. Above 10000: fail, unless the label large-pr/,
      );
    });
  });
});
