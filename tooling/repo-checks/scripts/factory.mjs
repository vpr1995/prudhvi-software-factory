// Factory CLI (design factory-daily-run 4.1). Logic lives in lib/factory-*.mjs.
//
// route <n> [--base <ref>]: print the router JSON (4.2) for the diff <ref>...HEAD (default
// origin/main) and the `Size:` line of ticket <n>. The local test guard gives the check-config
// finding (R-21). The JSON is stored in `.claude/factory/<n>/route.json` and the one routing line
// for the PR body in `route-line.txt` (R-20). The line goes to stderr too.
//
// push <n>: the local test guard, then `git push origin HEAD:<branch>` (task 2a2, R-17, R-54).
// stage, note, read, round, findings: the state commands of lib/factory-state.mjs (task 2a1).
//
// A `gh` call that fails twice, or a second push reject, is a hard stop: exit 3 and the message
// `hard stop: <reason>` (lib/factory-github.mjs).
//
// Run from the repo root: node tooling/repo-checks/scripts/factory.mjs route 98
import path from 'node:path';

import { fail, parseJson, stateFolder, withLock } from './lib/factory-base.mjs';
import {
  COMMAND_TIMEOUT_MS,
  gh,
  GIT_TIMEOUT_MS,
  HardStopError,
  run,
} from './lib/factory-github.mjs';
import { pushCommand } from './lib/factory-push.mjs';
import { parseSize, route, routingLine } from './lib/factory-route.mjs';
import { COMMANDS, FactoryError, SYNOPSES } from './lib/factory-state.mjs';
import { readStdin, writeAtomic } from './lib/fs-io.mjs';
import { readDiff } from './lib/test-guard-diff.mjs';
import { CHECK_CONFIG_MESSAGE } from './lib/test-guard-rules.mjs';
import { guardDiff, guardRepository } from './test-guard.mjs';

export { COMMAND_TIMEOUT_MS, run };

const EXIT_PASS = 0;
const EXIT_ERROR = 2;
const EXIT_HARD_STOP = 3;
const FIRST_USER_ARGUMENT = 2;
const DEFAULT_BASE = 'origin/main';
const TICKET = /^\d+$/;
const USAGE = ['route <n> [--base <ref>]', 'push <n>', ...SYNOPSES]
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

function storeRoute(context, ticket, { result, line }) {
  const folder = path.join(stateFolder(context.root), ticket);
  withLock(context, () => {
    writeAtomic(path.join(folder, 'route.json'), `${JSON.stringify(result, undefined, 2)}\n`);
    writeAtomic(path.join(folder, 'route-line.txt'), `${line}\n`);
  });
}

function routeCommand({ ticket, base }, context) {
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
  storeRoute(context, ticket, { result, line });
  context.err(`${line}\n`);
  return `${JSON.stringify(result, undefined, 2)}\n`;
}

const HANDLERS = new Map([...COMMANDS, ['push', pushCommand], ['route', routeCommand]]);

/** @returns {object} The context of the commands. A test replaces any part. */
function commandContext(overrides) {
  const root = overrides.root ?? run('git', ['rev-parse', '--show-toplevel']).trim();
  return {
    gh,
    git: (args) => run('git', ['-C', root, ...args], GIT_TIMEOUT_MS),
    guard: (base) => guardRepository(root, base),
    now: () => new Date(),
    pid: process.pid,
    stdin: readStdin,
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
 * @param {object} [overrides] - Parts of the command context (root, gh, git, guard, now, pid, stdin, print, err).
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
