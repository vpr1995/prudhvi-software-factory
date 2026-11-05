// Coverage on changed lines. CI runs the build output after the tests of a project:
//   node tooling/vitest-config/dist/diff-coverage.js <base-sha> <project-path> < <project-path>/coverage/lcov.info
// It compares the base with the working tree (in CI, the tree is the PR head). Only lines that the
// lcov report lists count. Other lines (comments, types, files without coverage) are not coverable.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { COVERAGE_THRESHOLDS } from './config.js';

/** Line numbers by file. File paths are relative to the project folder. */
export type LinesByFile = ReadonlyMap<string, ReadonlySet<number>>;

/** Coverage of the changed lines. */
export type DiffCoverage = {
  readonly covered: number;
  readonly total: number;
  /** `file:line` for each changed coverable line that no test ran. */
  readonly uncovered: readonly string[];
  readonly isPassed: boolean;
};

/** Minimum share (percent) of changed coverable lines that tests must run. */
export const DIFF_COVERAGE_THRESHOLD = COVERAGE_THRESHOLDS.lines;

const PERCENT = 100;
const LCOV_FILE = 'SF:';
const LCOV_LINE = 'DA:';
const DIFF_NEW_FILE = '+++ ';
const HUNK_START = '@@ ';
const EXIT_PASS = 0;
const EXIT_FAIL = 1;
const EXIT_ERROR = 2;
// process.argv: node, script, then the user arguments.
const FIRST_USER_ARGUMENT = 2;
// 256 MiB.
const GIT_MAX_BUFFER = 268_435_456;

/**
 * Reads the line hits of an lcov report.
 *
 * @param lcov - Text of lcov.info.
 * @returns For each file, the line number and the hit count of each coverable line.
 */
export function parseLcov(lcov: string): Map<string, Map<number, number>> {
  const files = new Map<string, Map<number, number>>();
  let current: Map<number, number> | undefined;
  for (const line of lcov.split('\n')) {
    if (line.startsWith(LCOV_FILE)) {
      current = new Map();
      files.set(line.slice(LCOV_FILE.length).trim(), current);
    } else if (line.startsWith(LCOV_LINE) && current) {
      const [lineNumber = '', hits = ''] = line.slice(LCOV_LINE.length).split(',');
      current.set(Number(lineNumber), Number(hits));
    } else if (line.startsWith('end_of_record')) {
      current = undefined;
    }
  }
  return files;
}

/**
 * Reads the added and changed lines of a `git diff -U0` output.
 *
 * @param diff - Output of `git diff --relative -U0 --no-color`.
 * @returns For each file of the new side, the line numbers that the diff adds or changes.
 */
export function parseDiff(diff: string): Map<string, Set<number>> {
  const files = new Map<string, Set<number>>();
  let current: Set<number> | undefined;
  for (const line of diff.split('\n')) {
    if (line.startsWith(DIFF_NEW_FILE)) {
      const target = line.slice(DIFF_NEW_FILE.length).trim();
      current = target === '/dev/null' ? undefined : new Set();
      if (current) {
        files.set(target.replace(/^b\//, ''), current);
      }
    } else if (current) {
      addHunkLines(line, current);
    }
  }
  return files;
}

/**
 * Adds the new-side lines of one hunk header. `+c,0` adds no line. `+c` adds one line.
 *
 * @param line - One diff line.
 * @param lines - Set that gets the line numbers.
 */
function addHunkLines(line: string, lines: Set<number>): void {
  // Header: `@@ -a,b +c,d @@ context`. The third word is the new side.
  const range = line.startsWith(HUNK_START) ? line.split(' ')[2] : undefined;
  if (!range?.startsWith('+')) {
    return;
  }
  const [startText = '', countText] = range.slice(1).split(',');
  const start = Number(startText);
  const count = countText === undefined ? 1 : Number(countText);
  for (let offset = 0; offset < count; offset += 1) {
    lines.add(start + offset);
  }
}

/**
 * Compares changed lines with the lcov hits.
 *
 * @param changed - Changed lines by file (relative to the project folder).
 * @param hits - Line hits by file, from `parseLcov`. Absolute paths start with `projectDirectory`.
 * @param projectDirectory - Absolute project folder, to make absolute lcov paths relative.
 * @returns The coverage of the changed coverable lines.
 */
export function computeDiffCoverage(
  changed: LinesByFile,
  hits: ReadonlyMap<string, ReadonlyMap<number, number>>,
  projectDirectory: string,
): DiffCoverage {
  const relativeHits = new Map(
    [...hits].map(([file, lines]) => [
      file.startsWith(`${projectDirectory}/`) ? file.slice(projectDirectory.length + 1) : file,
      lines,
    ]),
  );
  let covered = 0;
  let total = 0;
  const uncovered: string[] = [];
  for (const [file, lines] of [...changed].toSorted(([a], [b]) => a.localeCompare(b))) {
    const fileHits = relativeHits.get(file);
    if (!fileHits) {
      continue;
    }
    for (const line of [...lines].toSorted((a, b) => a - b)) {
      const count = fileHits.get(line);
      if (count === undefined) {
        continue;
      }
      total += 1;
      if (count > 0) {
        covered += 1;
      } else {
        uncovered.push(`${file}:${String(line)}`);
      }
    }
  }
  const isPassed = total === 0 || (covered / total) * PERCENT >= DIFF_COVERAGE_THRESHOLD;
  return { covered, total, uncovered, isPassed };
}

/**
 * @param result - Result of `computeDiffCoverage`.
 * @returns The report text.
 */
export function formatReport(result: DiffCoverage): string {
  if (result.total === 0) {
    return 'diff-coverage: no changed coverable lines. Pass.\n';
  }
  const percent = ((result.covered / result.total) * PERCENT).toFixed(1);
  const verdict = result.isPassed ? 'Pass' : 'Fail';
  const head = `diff-coverage: ${String(result.covered)} of ${String(result.total)} changed coverable lines covered (${percent}%, minimum ${String(DIFF_COVERAGE_THRESHOLD)}%). ${verdict}.\n`;
  if (result.uncovered.length === 0) {
    return head;
  }
  return `${head}Uncovered changed lines:\n${result.uncovered.map((entry) => `  ${entry}\n`).join('')}`;
}

/** Runs `git diff` and gives its stdout. */
type RunGit = (
  projectDirectory: string,
  base: string,
) => { status: number | null; stdout: string; stderr: string };

/** Inputs of `main`. */
export type MainInput = {
  /** `[baseSha, projectPath]`. */
  readonly args: readonly string[];
  /** Text of the project lcov.info. */
  readonly lcov: string;
  /** Runs `git diff` in the project folder. */
  readonly runGit: RunGit;
  /** Folder that `projectPath` is relative to. */
  readonly cwd: string;
};

/**
 * Runs the check.
 *
 * @param input - Arguments, lcov text, git runner and working folder.
 * @returns The exit code (0 pass, 1 fail, 2 usage or git error) and the output.
 */
export function main({ args, lcov, runGit, cwd }: MainInput): { code: number; output: string } {
  const [base, projectPath] = args;
  if (!base || !projectPath) {
    return {
      code: EXIT_ERROR,
      output:
        'Usage: diff-coverage <base-sha> <project-path> < <project-path>/coverage/lcov.info\n',
    };
  }
  const projectDirectory = projectPath.startsWith('/') ? projectPath : `${cwd}/${projectPath}`;
  const git = runGit(projectDirectory, base);
  if (git.status !== 0) {
    return { code: EXIT_ERROR, output: `diff-coverage: git diff failed.\n${git.stderr}` };
  }
  const result = computeDiffCoverage(parseDiff(git.stdout), parseLcov(lcov), projectDirectory);
  return { code: result.isPassed ? EXIT_PASS : EXIT_FAIL, output: formatReport(result) };
}

if (import.meta.main) {
  const { code, output } = main({
    args: process.argv.slice(FIRST_USER_ARGUMENT),
    lcov: readFileSync(0, 'utf8'),
    runGit: (projectDirectory, base) =>
      spawnSync(
        'git',
        [
          '-C',
          projectDirectory,
          'diff',
          '--relative',
          '-U0',
          '--no-color',
          '--no-ext-diff',
          base,
          '--',
        ],
        { encoding: 'utf8', maxBuffer: GIT_MAX_BUFFER },
      ),
    cwd: process.cwd(),
  });
  (code === EXIT_PASS ? process.stdout : process.stderr).write(output);
  process.exitCode = code;
}
