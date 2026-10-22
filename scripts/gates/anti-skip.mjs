// Anti-skip scanner. Used by the Claude stop-gate and by CI (check-gates).
// It fails when a diff adds a skip, a disable comment, a lowered threshold, or removes tests.
import { formatFinding, scanFiles } from './lib/anti-skip-engine.mjs';
import { collectDiff } from './lib/diff-source.mjs';
import { antiSkipSettings } from './lib/gate-list.mjs';
import { repositoryRoot } from './lib/git-state.mjs';

const HELP = `anti-skip: fail when a diff adds a skip, a disable comment, a lowered coverage
threshold, or removes tests.

Usage:
  node scripts/gates/anti-skip.mjs [--base <commit> | --range <a..b> | --staged | --stdin] [--json] [--root <dir>]

Modes:
  --base <commit>   working tree (and untracked files) against a commit. Default: HEAD.
  --range <a..b>    a git range, for CI, for example origin/main...HEAD.
  --staged          the index against HEAD.
  --stdin           a unified diff on stdin (git diff -U0).
Options:
  --json            print the findings as JSON on stdout.
  --root <dir>      repo root. Default: the git root of the current folder.
  --help            show this text.

Exit code: 0 no findings, 1 findings (file:line: [rule] message on stderr), 2 bad usage or a scan that could not run.
Skipped paths and the coverage-only paths are set in scripts/gates/gate-files.json (antiSkip).
`;

const VALUE_FLAGS = new Set(['--base', '--range', '--root']);

/**
 * Reads the command line.
 *
 * @param {string[]} argv - Arguments after the script name.
 * @returns {{ options: Record<string, string | boolean>, error: string }} Parsed flags.
 */
function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const word = argv[index] ?? '';
    if (VALUE_FLAGS.has(word)) {
      options[word.slice(2)] = argv[index + 1] ?? '';
      index += 1;
    } else if (['--staged', '--stdin', '--json', '--help', '-h'].includes(word)) {
      options[word.replace(/^-+/, '')] = true;
    } else {
      return { options, error: `unknown argument: ${word}` };
    }
  }
  return { options, error: '' };
}

/**
 * Runs the scanner.
 *
 * @param {string[]} argv - Arguments after the script name.
 * @returns {number} Exit code.
 */
export function main(argv) {
  const { options, error } = parseArguments(argv);
  if (error !== '') {
    process.stderr.write(`${error}\n\n${HELP}`);
    return 2;
  }
  if (options['help'] === true || options['h'] === true) {
    process.stdout.write(HELP);
    return 0;
  }
  const start = typeof options['root'] === 'string' ? options['root'] : process.cwd();
  let source;
  let findings;
  try {
    const root = repositoryRoot(start);
    source = collectDiff({
      root,
      base: typeof options['base'] === 'string' ? options['base'] : undefined,
      range: typeof options['range'] === 'string' ? options['range'] : undefined,
      staged: options['staged'] === true,
      stdin: options['stdin'] === true,
    });
    findings = scanFiles(source.files, {
      readFile: source.readFile,
      settings: antiSkipSettings(),
    });
  } catch (error) {
    // A scan that cannot run must never look like a pass.
    process.stderr.write(
      `anti-skip: could not scan: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 2;
  }
  if (options['json'] === true) {
    process.stdout.write(`${JSON.stringify(findings, null, 2)}\n`);
  }
  if (findings.length === 0) {
    process.stdout.write(
      `anti-skip: pass (${String(source.files.length)} changed files scanned)\n`,
    );
    return 0;
  }
  process.stderr.write(
    `${findings.map((finding) => formatFinding(finding)).join('\n')}\nanti-skip: ${String(findings.length)} finding(s). Fix the cause. Do not skip, delete, or weaken tests or rules.\n`,
  );
  return 1;
}

if (import.meta.filename === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}
