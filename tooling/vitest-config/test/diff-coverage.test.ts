import { describe, expect, it } from 'vitest';

import { COVERAGE_THRESHOLDS } from '../src/config.js';
import {
  computeDiffCoverage,
  DIFF_COVERAGE_THRESHOLD,
  formatReport,
  main,
  parseDiff,
  parseLcov,
} from '../src/diff-coverage.js';

const PROJECT = '/repo/packages/result';

const LCOV = [
  'TN:',
  'SF:src/a.ts',
  'FN:1,a',
  'DA:1,1',
  'DA:2,0',
  'DA:3,4',
  'end_of_record',
  'SF:/repo/packages/result/src/b.ts',
  'DA:10,0',
  'end_of_record',
  'DA:99,1',
  '',
].join('\n');

const DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,0 +2,2 @@',
  '+x',
  '+y',
  '@@ -9 +11 @@ context',
  '-old',
  '+new',
  '@@ -20,3 +22,0 @@',
  'diff --git a/src/gone.ts b/src/gone.ts',
  '--- a/src/gone.ts',
  '+++ /dev/null',
  '@@ -1,2 +0,0 @@',
  '+++ b/src/b.ts',
  '@@ -0,0 +10 @@',
  '',
].join('\n');

/** Changed lines as a map, for short test input. */
function changed(entries: Record<string, number[]>): Map<string, Set<number>> {
  return new Map(Object.entries(entries).map(([file, lines]) => [file, new Set(lines)]));
}

describe('parseLcov', () => {
  it('reads the hits of each file', () => {
    const files = parseLcov(LCOV);
    expect([...files.keys()]).toEqual(['src/a.ts', '/repo/packages/result/src/b.ts']);
    expect([...(files.get('src/a.ts') ?? [])]).toEqual([
      [1, 1],
      [2, 0],
      [3, 4],
    ]);
  });
});

describe('parseDiff', () => {
  it('reads the added and changed lines of the new side', () => {
    const files = parseDiff(DIFF);
    expect([...files.keys()]).toEqual(['src/a.ts', 'src/b.ts']);
    expect([...(files.get('src/a.ts') ?? [])]).toEqual([2, 3, 11]);
    expect([...(files.get('src/b.ts') ?? [])]).toEqual([10]);
  });
});

describe('computeDiffCoverage', () => {
  it('uses the line threshold of the shared config', () => {
    expect(DIFF_COVERAGE_THRESHOLD).toBe(COVERAGE_THRESHOLDS.lines);
  });

  it('counts only changed lines that lcov lists', () => {
    const result = computeDiffCoverage(
      changed({ 'src/a.ts': [1, 2, 3, 50], 'src/b.ts': [10], 'README.md': [1] }),
      parseLcov(LCOV),
      PROJECT,
    );
    expect(result).toEqual({
      covered: 2,
      total: 4,
      uncovered: ['src/a.ts:2', 'src/b.ts:10'],
      isPassed: false,
    });
  });

  it('passes without changed coverable lines', () => {
    const result = computeDiffCoverage(changed({ 'src/a.ts': [50] }), parseLcov(LCOV), PROJECT);
    expect(result.isPassed).toBe(true);
    expect(result.total).toBe(0);
  });

  it('passes at exactly the threshold and fails below it', () => {
    const hits = (covered: number): Map<string, Map<number, number>> =>
      new Map([
        [
          'src/c.ts',
          new Map(Array.from({ length: 10 }, (_, index) => [index + 1, index < covered ? 1 : 0])),
        ],
      ]);
    const lines = changed({ 'src/c.ts': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });
    expect(computeDiffCoverage(lines, hits(8), PROJECT).isPassed).toBe(true);
    expect(computeDiffCoverage(lines, hits(7), PROJECT).isPassed).toBe(false);
  });
});

describe('formatReport', () => {
  it('reports no coverable lines', () => {
    expect(formatReport({ covered: 0, total: 0, uncovered: [], isPassed: true })).toBe(
      'diff-coverage: no changed coverable lines. Pass.\n',
    );
  });

  it('reports the share and the uncovered lines', () => {
    expect(formatReport({ covered: 1, total: 2, uncovered: ['src/a.ts:2'], isPassed: false })).toBe(
      'diff-coverage: 1 of 2 changed coverable lines covered (50.0%, minimum 80%). Fail.\nUncovered changed lines:\n  src/a.ts:2\n',
    );
    expect(formatReport({ covered: 2, total: 2, uncovered: [], isPassed: true })).toContain(
      '(100.0%, minimum 80%). Pass.\n',
    );
  });
});

describe('main', () => {
  const okGit = (stdout: string) => () => ({ status: 0, stdout, stderr: '' });

  it('needs a base and a project path', () => {
    expect(main({ args: ['abc'], lcov: '', runGit: okGit(''), cwd: '/repo' }).code).toBe(2);
  });

  it('fails when git fails', () => {
    const runGit = (): { status: number; stdout: string; stderr: string } => ({
      status: 128,
      stdout: '',
      stderr: 'bad revision\n',
    });
    const result = main({ args: ['abc', 'packages/result'], lcov: '', runGit, cwd: '/repo' });
    expect(result).toEqual({ code: 2, output: 'diff-coverage: git diff failed.\nbad revision\n' });
  });

  it('runs git in the project folder and gives exit code 1 below the threshold', () => {
    const calls: string[][] = [];
    const runGit = (
      folder: string,
      base: string,
    ): { status: number; stdout: string; stderr: string } => {
      calls.push([folder, base]);
      return { status: 0, stdout: DIFF, stderr: '' };
    };
    const result = main({ args: ['abc', 'packages/result'], lcov: LCOV, runGit, cwd: '/repo' });
    expect(calls).toEqual([[PROJECT, 'abc']]);
    expect(result.code).toBe(1);
    expect(result.output).toContain('src/a.ts:2\n');
  });

  it('gives exit code 0 when the changed lines are covered', () => {
    const diff = '+++ b/src/a.ts\n@@ -0,0 +3 @@\n';
    const result = main({ args: ['abc', PROJECT], lcov: LCOV, runGit: okGit(diff), cwd: '/x' });
    expect(result.code).toBe(0);
  });
});
