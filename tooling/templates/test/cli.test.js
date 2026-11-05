// Tests for src/cli.js. The update step is a stub, so no test runs Rush.
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from '../src/cli.js';
import {
  makeTemporaryFolder,
  pathExists,
  readText,
  removeFolder,
  writeNewText,
} from '../src/fs-io.js';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const TEMPLATES = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const REFERENCE = 'packages/result/package.json';

let root = '';

beforeEach(async () => {
  root = await makeTemporaryFolder();
  await writeNewText(root, 'rush.json', await readText(REPO_ROOT, 'rush.json'));
  await writeNewText(root, REFERENCE, await readText(REPO_ROOT, REFERENCE));
});

afterEach(async () => {
  await removeFolder(root);
});

const context = (updateCode = 0) => ({
  root,
  templatesFolder: TEMPLATES,
  update: vi.fn(() => updateCode),
  out: vi.fn(),
  err: vi.fn(),
  now: new Date('2026-11-04T09:05:00Z'),
});

const text = (/** @type {import('vitest').Mock} */ mock) => mock.mock.calls.map(String).join('');

describe('rush new', () => {
  it('makes a library, runs rush update and prints the next steps', async () => {
    const runContext = context();

    expect(await run(['--library', 'date-utils'], runContext)).toBe(0);
    expect(runContext.update).toHaveBeenCalledOnce();
    expect(await pathExists(root, 'packages/date-utils/package.json')).toBe(true);
    expect(text(runContext.out)).toContain('rush verify --to @vprprudhvi/shared-date-utils');
    expect(runContext.err).not.toHaveBeenCalled();
  });

  it.each([[[]], [['--library']], [['--project', 'x']], [['date-utils']]])(
    'fails with usage for %j',
    async (argv) => {
      const runContext = context();
      expect(await run(argv, runContext)).toBe(1);
      expect(text(runContext.err)).toContain('Usage: rush new --library <name>');
      expect(runContext.update).not.toHaveBeenCalled();
    },
  );

  it('fails on an empty name', async () => {
    const runContext = context();
    expect(await run(['--library', ''], runContext)).toBe(1);
    expect(text(runContext.err)).toContain('is not kebab-case');
  });

  it('fails with the scaffold message and does not run rush update', async () => {
    const runContext = context();
    expect(await run(['--library', 'Bad'], runContext)).toBe(1);
    expect(text(runContext.err)).toContain('name "Bad" is not kebab-case');
    expect(runContext.update).not.toHaveBeenCalled();
  });

  it('returns the rush update exit code when it fails', async () => {
    const runContext = context(3);
    expect(await run(['--library', 'date-utils'], runContext)).toBe(3);
    expect(text(runContext.err)).toContain('rush update failed (exit 3)');
  });
});
