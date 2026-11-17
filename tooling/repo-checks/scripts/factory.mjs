// Factory CLI (design factory-daily-run 4.1). Logic lives in lib/factory-*.mjs.
//
// route <n> [--base <ref>]: print the router JSON (4.2) for the diff <ref>...HEAD (default
// origin/main) and the `Size:` line of ticket <n>. The local test guard gives the check-config
// finding (R-21). Print only: a later task stores the JSON in the ticket state.
//
// stage, note, read, round, findings: the state commands of lib/factory-state.mjs (task 2a1).
//
// Run from the repo root: node tooling/repo-checks/scripts/factory.mjs route 98
import { execFileSync } from 'node:child_process';

import { parseSize, route } from './lib/factory-route.mjs';
import { COMMANDS, execute, FactoryError, SYNOPSES } from './lib/factory-state.mjs';
import { readStdin } from './lib/fs-io.mjs';
import { readDiff } from './lib/test-guard-diff.mjs';
import { CHECK_CONFIG_MESSAGE } from './lib/test-guard-rules.mjs';
import { guardDiff } from './test-guard.mjs';

const EXIT_PASS = 0;
const EXIT_ERROR = 2;
const FIRST_USER_ARGUMENT = 2;
export const COMMAND_TIMEOUT_MS = 30_000;
const DEFAULT_BASE = 'origin/main';
const TICKET = /^\d+$/;
const USAGE = ['route <n> [--base <ref>]', ...SYNOPSES]
  .map((synopsis) => `Usage: node tooling/repo-checks/scripts/factory.mjs ${synopsis}\n`)
  .join('');

/** @returns {string} Stdout of the command. A command that runs longer than the timeout throws. */
export function run(command, args, timeout = COMMAND_TIMEOUT_MS) {
  return execFileSync(command, args, { encoding: 'utf8', timeout });
}

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

function routeCommand({ ticket, base }) {
  const root = run('git', ['rev-parse', '--show-toplevel']).trim();
  const { body } = JSON.parse(run('gh', ['issue', 'view', ticket, '--json', 'body']));
  const diff = readDiff(root, base);
  const result = buildRoute({
    base,
    body,
    files: changedFiles(diff),
    findings: guardDiff(root, diff),
  });
  return `${JSON.stringify(result, undefined, 2)}\n`;
}

/** @returns {object} The context of the state commands. A test replaces any part. */
function stateContext(overrides) {
  const gh = (args) => run('gh', args);
  const git = (args) => run('git', args);
  const context = {
    gh,
    git,
    now: () => new Date(),
    pid: process.pid,
    stdin: readStdin,
    print: (text) => process.stdout.write(text),
    ...overrides,
  };
  return { ...context, root: context.root ?? run('git', ['rev-parse', '--show-toplevel']).trim() };
}

function stateMain(command, words, overrides) {
  const writeError = overrides.err ?? ((text) => process.stderr.write(text));
  try {
    const context = stateContext(overrides);
    context.print(execute(command, words, context));
    return EXIT_PASS;
  } catch (error) {
    const known = error instanceof FactoryError;
    const reason = error instanceof Error ? error.message : String(error);
    writeError(`factory ${command}: ${known ? '' : 'unexpected error: '}${reason}\n`);
    return EXIT_ERROR;
  }
}

/**
 * @param {string[]} argv - Process arguments.
 * @param {object} [overrides] - Parts of the state context (root, gh, git, now, pid, stdin, print, err).
 * @returns {number} Exit code.
 */
export function main(argv = process.argv, overrides = {}) {
  const [command, ...words] = argv.slice(FIRST_USER_ARGUMENT);
  if (COMMANDS.has(command)) return stateMain(command, words, overrides);
  const routeArguments = command === 'route' ? parseRouteArguments(words) : undefined;
  if (routeArguments === undefined) {
    process.stderr.write(USAGE);
    return EXIT_ERROR;
  }
  try {
    process.stdout.write(routeCommand(routeArguments));
    return EXIT_PASS;
  } catch (error) {
    process.stderr.write(
      `factory route: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return EXIT_ERROR;
  }
}

if (import.meta.main) {
  process.exitCode = main();
}
