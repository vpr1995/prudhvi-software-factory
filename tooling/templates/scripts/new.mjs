// Entry point for `rush new` (common/config/rush/command-line.json).
// Run: node common/scripts/install-run-rush.js new --library <name>
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { run } from '../src/cli.js';

const templatesFolder = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const root = fileURLToPath(new URL('../../..', import.meta.url)).replace(/\/$/, '');

process.exitCode = await run(process.argv.slice(2), {
  root,
  templatesFolder,
  update: () =>
    spawnSync('node', ['common/scripts/install-run-rush.js', 'update'], {
      cwd: root,
      stdio: 'inherit',
    }).status ?? 1,
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
});
