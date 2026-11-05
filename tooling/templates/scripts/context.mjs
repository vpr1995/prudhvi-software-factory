// Repo paths and output functions for the `rush new` and `rush add-part` entry points.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const templatesFolder = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const root = fileURLToPath(new URL('../../..', import.meta.url)).replace(/\/$/, '');

/** @type {import('../src/cli.js').CliContext} */
export const context = {
  root,
  templatesFolder,
  update: () =>
    spawnSync('node', ['common/scripts/install-run-rush.js', 'update'], {
      cwd: root,
      stdio: 'inherit',
    }).status ?? 1,
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
};
