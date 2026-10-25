// Gate fixtures: plants one bad change for each row of plan section 11 (and the new rules) in a
// throwaway git worktree, runs the gate that must reject it, and writes the proof to
// docs/standards/gate-fixtures.md. The local gates only: the rows that need CI are listed, not run.
import path from 'node:path';

import { writeText } from './lib/fs-io.mjs';
import { allFixtures } from './lib/gate-fixtures-list.mjs';
import { renderReport } from './lib/gate-fixtures-report.mjs';
import {
  exitCodeFor,
  parseFixtureArguments,
  runAll,
  selectFixtures,
  summarize,
} from './lib/gate-fixtures-run.mjs';
import { createWorktree } from './lib/gate-fixtures-worktree.mjs';
import { findGate } from './lib/gate-list.mjs';
import { git, gitOrThrow, run } from './lib/proc.mjs';

const MAIN = path.resolve(import.meta.dirname, '..', '..');
const DEFAULT_REPORT = path.join(MAIN, 'docs', 'standards', 'gate-fixtures.md');

const HELP = `gate-fixtures: plant each bad change of plan section 11 in a throwaway git worktree and check that the local gates reject it.

Usage:
  node scripts/gates/gate-fixtures.mjs [--only <id,...>] [--slow] [--keep] [--report <path>] [--list]

  --only <id,...>   run only these fixtures. An unknown id is an error. With --only the report is
                    printed and not written, unless --report is given (a partial run must not
                    replace the full proof).
  --slow            also run the slow fixtures (cdk-nag, with the real stack test).
  --keep            keep the worktree and print its path (debugging). Remove it later with
                    git worktree remove --force <path>.
  --report <path>   write the Markdown report here. Default: docs/standards/gate-fixtures.md
  --list            print the fixture ids and exit.

How it works: git worktree add --detach <tmp>/worktree HEAD. Each fixture resets the worktree to
that commit, makes its bad change, runs the gate, and checks the exit code and the text. The gate
code (hooks, scripts/gates, tool binaries) is read from this working tree, so gate files that a
human applied and did not commit are tested. The script does not change a tracked file of this
working tree, except the report. Git writes the worktree record to .git/worktrees, and a tool can
write its cache to a node_modules folder of this tree. A control fixture is a clean change that the
gate must accept. A fixture marked "needs agent A, B or C" fails until a human applies that handoff
file. Ctrl-C (SIGINT) or SIGTERM stops the run after the current gate command, removes the
worktree, and exits 130 or 143.

Exit code: 0 when every fixture that ran passed. 1 when a bad change was not rejected, a control was
rejected, or a setup step failed. 2 for bad usage.
`;

/**
 * Lists the gate files of the main tree that have an uncommitted change.
 *
 * @returns {string[]} Repo-relative paths.
 */
function dirtyGateFiles() {
  const status = gitOrThrow(MAIN, ['status', '--porcelain', '--untracked-files=all']).stdout;
  return status
    .split('\n')
    .filter((line) => line.length > 3)
    .map((line) => line.slice(3).replace(/^.* -> /, ''))
    .filter((file) => findGate(file) !== null);
}

/**
 * Builds the executor that the runner uses: the real worktree and the real processes.
 *
 * @param {ReturnType<typeof createWorktree>} worktree - The worktree.
 * @returns {Parameters<typeof runAll>[1]} The context.
 */
function buildContext(worktree) {
  return {
    variables: {
      main: MAIN,
      worktree: worktree.root,
      sample: path.join(worktree.root, 'projects', 'sample'),
      base: worktree.startSha,
    },
    reset: () => worktree.reset(),
    apply: (step) => worktree.apply(step),
    run: (call) => {
      const result = run(call.program, call.args, {
        cwd: call.cwd,
        input: call.input,
        timeoutMs: call.timeoutMs,
        env: { ...worktree.env, ...call.env },
      });
      return { ...result, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
    },
    onRow: printRow,
  };
}

/**
 * Prints one result line while the fixtures run.
 *
 * @param {Record<string, string | number>} row - A report row.
 * @returns {void}
 */
function printRow(row) {
  process.stdout.write(`${String(row['result']).padEnd(24)} ${String(row['id'])}\n`);
}

/** The context of a plan where every fixture is skipped: nothing runs, so no worktree is made. */
const IDLE_CONTEXT = {
  variables: {},
  reset: () => {
    // Nothing to reset: no worktree exists.
  },
  apply: () => {
    // Nothing to apply: no worktree exists.
  },
  run: () => {
    throw new Error('no fixture runs, so there is no worktree');
  },
  onRow: printRow,
};

/**
 * Gives the event loop one turn. A gate command runs with spawnSync, which blocks the loop, so a
 * SIGINT or SIGTERM handler runs only at such a turn: between two fixtures.
 *
 * @returns {Promise<void>} Resolves after the turn.
 */
function yieldTurn() {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

/**
 * Runs a plan in a throwaway worktree and removes the worktree at the end, also on failure and on
 * SIGINT or SIGTERM. A signal stops the run before the next fixture and removes the worktree. Then
 * the handlers are removed and the script sends the same signal to itself, so the process ends the
 * way an unhandled signal ends it: the shell sees exit 130 (SIGINT) or 143 (SIGTERM). The child of
 * the current gate command gets a Ctrl-C too, because it is in the same process group.
 *
 * @param {ReturnType<typeof selectFixtures>} plan - The plan.
 * @param {boolean} keep - Keep the worktree.
 * @returns {Promise<Record<string, string | number>[]>} The rows.
 */
async function runInWorktree(plan, keep) {
  const worktree = createWorktree(MAIN);
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) {
      return;
    }
    cleaned = true;
    if (keep) {
      process.stdout.write(`gate-fixtures: kept the worktree at ${worktree.root}\n`);
      return;
    }
    for (const problem of worktree.cleanup()) {
      process.stderr.write(`gate-fixtures: ${problem}\n`);
    }
  };
  /** @param {'SIGINT' | 'SIGTERM'} signal - The signal. */
  const onSignal = (signal) => {
    process.stderr.write(`gate-fixtures: stopped by ${signal}.\n`);
    cleanup();
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    process.kill(process.pid, signal);
  };
  process.once('exit', cleanup);
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    const context = buildContext(worktree);
    const rows = [];
    for (const entry of plan) {
      await yieldTurn();
      rows.push(...runAll([entry], context));
    }
    await yieldTurn();
    return rows;
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    cleanup();
  }
}

/**
 * Runs the gate fixtures.
 *
 * @param {string[]} argv - Arguments after the script name.
 * @returns {Promise<number>} The exit code.
 */
export async function main(argv) {
  const options = parseFixtureArguments(argv);
  if (options.error !== '') {
    process.stderr.write(`gate-fixtures: ${options.error}\n\n${HELP}`);
    return 2;
  }
  if (options.help) {
    process.stdout.write(HELP);
    return 0;
  }
  const fixtures = allFixtures();
  if (options.list) {
    process.stdout.write(`${fixtures.map((fixture) => fixture.id).join('\n')}\n`);
    return 0;
  }
  let plan;
  try {
    plan = selectFixtures(fixtures, options);
  } catch (error) {
    process.stderr.write(
      `gate-fixtures: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 2;
  }
  let rows;
  try {
    rows = plan.some((entry) => entry.skip === null)
      ? await runInWorktree(plan, options.keep)
      : runAll(plan, IDLE_CONTEXT);
  } catch (error) {
    process.stderr.write(
      `gate-fixtures: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
  const report = renderReport({
    date: new Date().toISOString().slice(0, 10),
    commit: git(MAIN, ['rev-parse', '--short', 'HEAD']).stdout.trim(),
    dirtyGates: dirtyGateFiles(),
    mode: options.only.length === 0 ? 'all fixtures' : `--only ${options.only.join(',')}`,
    slow: options.slow,
    rows,
  });
  const target = options.report === '' ? DEFAULT_REPORT : path.resolve(options.report);
  if (options.only.length === 0 || options.report !== '') {
    writeText(target, report);
    process.stdout.write(`gate-fixtures: report written to ${path.relative(MAIN, target)}\n`);
  } else {
    process.stdout.write(`\n${report}`);
  }
  const counts = summarize(rows);
  process.stdout.write(
    `gate-fixtures: ${String(counts.pass)} pass, ${String(counts.fail)} fail, ${String(counts.skip)} skip\n`,
  );
  return exitCodeFor(rows);
}

if (import.meta.filename === process.argv[1]) {
  process.exitCode = await main(process.argv.slice(2));
}
