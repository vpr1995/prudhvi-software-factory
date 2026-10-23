// Risk tier of a pull request from path rules (docs/standards/risk-tiers.md, section 2).
// It classifies. It does not fail: the exit code is 0 unless the command cannot run.
// The Claude classifier (a later step) can only raise the tier that this script gives.
import { repositoryRoot } from './lib/git-state.mjs';
import { git } from './lib/proc.mjs';
import { mergeBase, resolveCommit } from './lib/revisions.mjs';
import { classifyPaths } from './lib/risk-rules.mjs';
import { changedPaths } from './lib/test-impact.mjs';

const HELP = `classify-risk: give a pull request a risk tier from the path rules.

Usage:
  node scripts/gates/classify-risk.mjs --base <ref> --head <ref> [--json] [--root <dir>]

Options:
  --base <ref>   the base of the PR (a commit, branch or tag).
  --head <ref>   the head of the PR.
  --json         print { tier, files: [{ file, tier, rule, reason }] } on stdout.
  --root <dir>   repo root. Default: the git root of the current folder.
  --help         show this text.

The tier is the highest tier of the changed files: high, medium or low. An empty change is low.
Exit code: 0 (it classifies, it does not fail), 2 for bad usage or a change that cannot be read.
`;

const VALUE_FLAGS = new Set(['--base', '--head', '--root']);
const SWITCH_FLAGS = new Set(['--json', '--help', '-h']);
/** The human output lists this many files. The JSON output has all of them. */
const LISTED_FILES = 25;

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
      const value = argv[index + 1];
      if (value === undefined) {
        return { options, error: `missing value for ${word}` };
      }
      options[word.slice(2)] = value;
      index += 1;
    } else if (SWITCH_FLAGS.has(word)) {
      options[word.replace(/^-+/, '')] = true;
    } else {
      return { options, error: `unknown argument: ${word}` };
    }
  }
  return { options, error: '' };
}

/**
 * Classifies the range base...head.
 *
 * @param {{ root: string, base: string, head: string }} input - The repo and the range.
 * @returns {ReturnType<typeof classifyPaths>} The tier and the tier of each file. It throws when a revision is bad or git fails.
 */
export function classifyRange(input) {
  const base = resolveCommit(input.root, input.base);
  const head = resolveCommit(input.root, input.head);
  const start = mergeBase(input.root, base, head);
  const show = (revision) => (file) => {
    const shown = git(input.root, ['show', `${revision}:${file}`]);
    return shown.status === 0 ? shown.stdout : null;
  };
  const { files } = changedPaths(input.root, { base, head });
  return classifyPaths(files, { diff: { readBase: show(start), readHead: show(head) } });
}

/**
 * Writes the result as a short text.
 *
 * @param {ReturnType<typeof classifyPaths>} result - The result.
 * @returns {string} The tier line and one line for each file (the first files only).
 */
export function formatResult(result) {
  const counts = ['high', 'medium', 'low']
    .map((tier) => `${String(result.files.filter((entry) => entry.tier === tier).length)} ${tier}`)
    .join(', ');
  const lines = [`risk:${result.tier} (${String(result.files.length)} files: ${counts})`];
  for (const entry of result.files.slice(0, LISTED_FILES)) {
    lines.push(`  ${entry.tier.padEnd(6)} ${entry.file}: ${entry.reason}`);
  }
  if (result.files.length > LISTED_FILES) {
    lines.push(`  ... and ${String(result.files.length - LISTED_FILES)} more files (use --json)`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Runs the command.
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
  const base = options['base'];
  const head = options['head'];
  if (typeof base !== 'string' || typeof head !== 'string') {
    process.stderr.write(`--base and --head are required\n\n${HELP}`);
    return 2;
  }
  let result;
  try {
    const start = typeof options['root'] === 'string' ? options['root'] : process.cwd();
    result = classifyRange({ root: repositoryRoot(start), base, head });
  } catch (caught) {
    // A change that cannot be read must never look like a low tier.
    process.stderr.write(
      `classify-risk: could not classify: ${caught instanceof Error ? caught.message : String(caught)}\n`,
    );
    return 2;
  }
  process.stdout.write(
    options['json'] === true ? `${JSON.stringify(result, null, 2)}\n` : formatResult(result),
  );
  return 0;
}

if (import.meta.filename === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}
