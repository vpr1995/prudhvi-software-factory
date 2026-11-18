// Factory CLI (design factory-daily-run 4.1). Logic lives in lib/factory-*.mjs.
//
// route <n> [--base <ref>]: print the router JSON (4.2) for the diff <ref>...HEAD (default
// origin/main) and the `Size:` line of ticket <n>. The local test guard gives the check-config
// finding (R-21). The JSON is stored in the `routing` field of `.claude/factory/<n>/ticket.json`
// (R-20, design 4.3). The one routing line for the PR body goes to stderr only: `routingLine`
// builds it from the stored JSON. With no `ticket.json`, nothing is stored and stderr has a warning.
//
// start [<n>] [--dry-run]: build the queue, mark the run active or adopt it, print the plan
// (lib/factory-queue.mjs, task 2c). `--dry-run` writes nothing. `FACTORY_RUN=off` refuses (R-4).
//
// next: find the next step (resume, start, CI wait, or done) and store it in run.json. On `done`
// it writes the run report and clears the run (R-5). status: print the run state, read only
// (R-46). stop: clear the run, keep each ticket.json, change no label, write the report (R-47).
// report: write the run report (R-29). Code: lib/factory-next.mjs, lib/factory-report.mjs.
// approve <n>, decline <n>: the answer of the owner to the step `approve #<n>` of a ticket with a
// protected path in its `Paths:` line (#146). Stored in run.json. No label change.
//
// wait <n>: mark a CI wait, poll `gh pr checks` every 30 s until CI ends, exit "timeout" (exit 3,
// hard stop "CI timeout") after 60 minutes (R-49). Code: lib/factory-wait.mjs. The Stop hook is the
// separate entry scripts/factory-stop-check.mjs: it loads no other factory code until a run is open (R-56).
//
// stack plan <n>: print the stack plan of ticket <n> and its base branch (R-36, R-42, R-41, R-6). Read
// only. restack <n>: merge the stack base (or main after the blocker PR merged) into the branch, push,
// and mark the PR ready (R-38, R-39). R-37: `route` and `push` use the stack base of `ticket.json`.
// Code: lib/factory-stack.mjs.
//
// push <n>: the local test guard, then `git push origin HEAD:<branch>` (task 2a2, R-17, R-54).
// stage, note, read, round, findings: the state commands of lib/factory-state.mjs (task 2a1).
//
// comment <n> <hard-stop|reply> [<reply-to-id>]: post an agent comment from stdin with the marker
// line (R-8). A reply with an id answers a new owner comment of the open PR (R-9), stores the id in
// `handledComments` and adds 1 to `threadReplies` of its thread (R-30, R-31).
// comments <n>: print the new owner comments of ticket <n>. `next` gives them first (R-30).
// Code: lib/factory-comments.mjs.
// hardstop <n> "<reason>" [--detail "<text>"]: the R-12 steps, error excerpt on stdin (lib/factory-hard-stop.mjs).
// caps <n>: derive the cap counts, print JSON, exit 3 when a cap is reached (lib/factory-caps.mjs).
// metrics <n>: create the `factory-metrics` comment of the ticket, or edit it in place, with the
// version 2 fields (R-32). The cost script reads the transcripts of the run sessions (R-33). The
// warnings (a value that is null) go to stderr. Code: lib/factory-metrics.mjs, lib/factory-cost.mjs.
//
// A `gh` call that fails twice, or a second push reject, is a hard stop: exit 3 and the message
// `hard stop: <reason>` (lib/factory-github.mjs).
//
// Run from the repo root: node tooling/repo-checks/scripts/factory.mjs route 98
import { fail, parseJson, withLock } from './lib/factory-base.mjs';
import { capsCommand } from './lib/factory-caps.mjs';
import { commentCommand } from './lib/factory-comment.mjs';
import { commentsCommand } from './lib/factory-comments.mjs';
import {
  COMMAND_TIMEOUT_MS,
  gh,
  GIT_TIMEOUT_MS,
  HardStopError,
  run,
} from './lib/factory-github.mjs';
import { hardstopCommand } from './lib/factory-hard-stop.mjs';
import { metricsCommand } from './lib/factory-metrics.mjs';
import { approveCommand, declineCommand, nextCommand, statusCommand } from './lib/factory-next.mjs';
import { pushCommand } from './lib/factory-push.mjs';
import { baseRef, MAIN_REF } from './lib/factory-queue-rules.mjs';
import { startCommand } from './lib/factory-queue.mjs';
import { reportCommand, stopCommand } from './lib/factory-report.mjs';
import { parseSize, route, routingLine } from './lib/factory-route.mjs';
import { restackCommand, stackCommand } from './lib/factory-stack.mjs';
import { COMMANDS, FactoryError, loadTicket, saveTicket, SYNOPSES } from './lib/factory-state.mjs';
import { waitCommand } from './lib/factory-wait.mjs';
import { currentSessionId, isRunOff, transcriptRoot } from './lib/factory.config.mjs';
import { readStdin } from './lib/fs-io.mjs';
import { readDiff } from './lib/test-guard-diff.mjs';
import { CHECK_CONFIG_MESSAGE } from './lib/test-guard-rules.mjs';
import { guardDiff, guardRepository } from './test-guard.mjs';

export { COMMAND_TIMEOUT_MS, run };

const EXIT_PASS = 0;
const EXIT_ERROR = 2;
const EXIT_HARD_STOP = 3;
const FIRST_USER_ARGUMENT = 2;
const DEFAULT_BASE = MAIN_REF;
const TICKET = /^\d+$/;
const USAGE = [
  'start [<n>] [--dry-run]',
  'next',
  'approve <n>',
  'decline <n>',
  'status',
  'stop',
  'report',
  'route <n> [--base <ref>]',
  'push <n>',
  'stack plan <n>',
  'restack <n>',
  'wait <n>',
  'comment <n> <hard-stop|reply> [<reply-to-id>]   (body on stdin)',
  'comments <n>',
  'hardstop <n> "<reason>" [--detail "<text>"]   (error excerpt on stdin)',
  'caps <n>',
  'metrics <n>',
  ...SYNOPSES,
]
  .map((synopsis) => `Usage: node tooling/repo-checks/scripts/factory.mjs ${synopsis}\n`)
  .join('');

/** @returns {{ ticket: string, base: string } | undefined} The route arguments, or undefined when they are not valid. */
export function parseRouteArguments(words) {
  const [ticket, flag, base, ...rest] = words;
  if (ticket === undefined || !TICKET.test(ticket) || rest.length > 0) return;
  if (flag === undefined) return { ticket, base: DEFAULT_BASE };
  if (flag !== '--base' || base === undefined || base === '' || base.startsWith('-')) return;
  return { ticket, base };
}

/** @returns {{ path: string, oldPath: string, added: number, deleted: number }[]} Changed files of a diff that readDiff returned. */
export function changedFiles({ entries, patch }) {
  return entries.map((entry) => {
    const lines = patch.get(entry.path) ?? patch.get(entry.oldPath);
    return {
      path: entry.path,
      oldPath: entry.oldPath,
      added: lines?.added.length ?? 0,
      deleted: lines?.removed.length ?? 0,
    };
  });
}

/** @returns {object} The router JSON. A test guard finding "check config changed" gives tier high (R-21). */
export function buildRoute({ base, body, files, findings }) {
  const checkConfig = findings.some((finding) => finding.message === CHECK_CONFIG_MESSAGE);
  return route({ base, changedFiles: files, size: parseSize(body), checkConfig });
}

/** @returns {boolean} True when the JSON is stored. False when the ticket has no state. */
function storeRoute(context, ticket, result) {
  return withLock(context, () => {
    const state = loadTicket(context.root, ticket);
    if (state === undefined) return false;
    saveTicket(context.root, ticket, { ...state, routing: result });
    return true;
  });
}

// R-37: with no `--base` (the default), a stacked ticket uses its stack base.
function routeCommand({ ticket, base: requested }, context) {
  const base = requested === DEFAULT_BASE ? baseRef(loadTicket(context.root, ticket)) : requested;
  const { body } = parseJson(
    context.gh(['issue', 'view', ticket, '--json', 'body']),
    'gh issue view',
  );
  if (typeof body !== 'string') fail('gh issue view: no ticket body');
  const diff = readDiff(context.root, base);
  const result = buildRoute({
    base,
    body,
    files: changedFiles(diff),
    findings: guardDiff(context.root, diff),
  });
  const line = routingLine(result);
  if (!storeRoute(context, ticket, result)) {
    context.err(`warning: #${ticket} has no ticket state: nothing stored\n`);
  }
  context.err(`${line}\n`);
  return `${JSON.stringify(result, undefined, 2)}\n`;
}

const HANDLERS = new Map([
  ...COMMANDS,
  ['approve', approveCommand],
  ['caps', capsCommand],
  ['comment', commentCommand],
  ['comments', commentsCommand],
  ['decline', declineCommand],
  ['hardstop', hardstopCommand],
  ['metrics', metricsCommand],
  ['next', nextCommand],
  ['push', pushCommand],
  ['report', reportCommand],
  ['restack', restackCommand],
  ['route', routeCommand],
  ['stack', stackCommand],
  ['start', startCommand],
  ['status', statusCommand],
  ['stop', stopCommand],
  ['wait', waitCommand],
]);

/** The command names of the CLI. The /factory skill test reads them. */
export const COMMAND_NAMES = new Set(HANDLERS.keys());

/** @returns {object} The context of the commands. A test replaces any part. */
function commandContext(overrides) {
  const root = overrides.root ?? run('git', ['rev-parse', '--show-toplevel']).trim();
  return {
    claudeVersion: () => run('claude', ['--version']),
    gh,
    git: (args) => run('git', ['-C', root, ...args], GIT_TIMEOUT_MS),
    guard: (base) => guardRepository(root, base),
    now: () => new Date(),
    pid: process.pid,
    runOff: isRunOff,
    sessionId: currentSessionId,
    stdin: readStdin,
    transcriptRoot,
    print: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
    ...overrides,
    root,
  };
}

function runCommand(command, input, overrides) {
  const writeError = overrides.err ?? ((text) => process.stderr.write(text));
  try {
    const context = commandContext(overrides);
    context.print(HANDLERS.get(command)(input, context));
    return EXIT_PASS;
  } catch (error) {
    if (error instanceof HardStopError) {
      writeError(`${error.message}\n`);
      return EXIT_HARD_STOP;
    }
    const known = error instanceof FactoryError;
    const reason = error instanceof Error ? error.message : String(error);
    writeError(`factory ${command}: ${known ? '' : 'unexpected error: '}${reason}\n`);
    return EXIT_ERROR;
  }
}

/**
 * @param {string[]} argv - Process arguments.
 * @param {object} [overrides] - Parts of the command context (root, claudeVersion, gh, git, guard, now, pid, runOff, sessionId, stdin, transcriptRoot, print, err).
 * @returns {number} Exit code: 0 done, 2 refused or failed, 3 hard stop.
 */
export function main(argv = process.argv, overrides = {}) {
  const [command, ...words] = argv.slice(FIRST_USER_ARGUMENT);
  const input = command === 'route' ? parseRouteArguments(words) : words;
  if (!HANDLERS.has(command) || input === undefined) {
    process.stderr.write(USAGE);
    return EXIT_ERROR;
  }
  return runCommand(command, input, overrides);
}

if (import.meta.main) {
  process.exitCode = main();
}
