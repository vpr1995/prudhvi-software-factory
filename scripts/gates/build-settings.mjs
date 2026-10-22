// Builds .claude/settings.pending.json (hook wiring and permissions) from scripts/gates/gate-files.json.
import path from 'node:path';

import { readText, writeText } from './lib/fs-io.mjs';
import { repositoryRoot } from './lib/git-state.mjs';
import { settingsText } from './lib/settings-builder.mjs';

const HELP = `build-settings: write .claude/settings.pending.json from scripts/gates/gate-files.json.

Usage:
  node scripts/gates/build-settings.mjs [--check] [--root <dir>]

  --check   do not write. Exit 1 when the file is missing or differs (a test uses this).
  --root    repo root. Default: the git root of the current folder.
  --help    show this text.

A human copies the result to .claude/settings.json, which is a gate file.
`;

/**
 * Runs the builder.
 *
 * @param {string[]} argv - Arguments after the script name.
 * @returns {number} Exit code.
 */
export function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(HELP);
    return 0;
  }
  const rootIndex = argv.indexOf('--root');
  const unknown = argv.filter(
    (word, index) => !['--check', '--root'].includes(word) && argv[index - 1] !== '--root',
  );
  if (unknown.length > 0) {
    process.stderr.write(`unknown argument: ${unknown[0] ?? ''}\n\n${HELP}`);
    return 2;
  }
  const root = repositoryRoot(
    rootIndex === -1 ? process.cwd() : (argv[rootIndex + 1] ?? process.cwd()),
  );
  const target = path.join(root, '.claude', 'settings.pending.json');
  const wanted = settingsText();
  if (argv.includes('--check')) {
    const same = readText(target) === wanted;
    process.stdout.write(
      same
        ? 'build-settings: settings.pending.json is up to date\n'
        : 'build-settings: settings.pending.json is missing or differs. Run node scripts/gates/build-settings.mjs\n',
    );
    return same ? 0 : 1;
  }
  writeText(target, wanted);
  process.stdout.write('build-settings: wrote .claude/settings.pending.json\n');
  return 0;
}

if (import.meta.filename === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}
