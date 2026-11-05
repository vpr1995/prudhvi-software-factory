// Tests for src/cli.js. The update step is a stub, so no test runs Rush.
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run, runAddPart } from '../src/cli.js';
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
const COPIED = [
  'rush.json',
  REFERENCE,
  'projects/sample/package.json',
  'docs/templates/REVIEW.api.md',
  'docs/templates/REVIEW.web.md',
  'docs/templates/REVIEW.infra.md',
];

let root = '';

beforeEach(async () => {
  root = await makeTemporaryFolder();
  for (const file of COPIED) await writeNewText(root, file, await readText(REPO_ROOT, file));
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

  it('makes a bare project and points to rush add-part', async () => {
    const runContext = context();

    expect(await run(['--project', 'notes-app'], runContext)).toBe(0);
    expect(await pathExists(root, 'projects/notes-app/scripts/phase.mjs')).toBe(true);
    expect(text(runContext.out)).toContain(
      'rush add-part --project notes-app --part <node|web|infra>',
    );
    expect(text(runContext.out)).not.toContain('change file');
  });

  it.each([
    [[]],
    [['--library']],
    [['--other', 'x']],
    [['date-utils']],
    [['--library', 'a', '--project', 'b']],
  ])('fails with usage for %j', async (argv) => {
    const runContext = context();
    expect(await run(argv, runContext)).toBe(1);
    expect(text(runContext.err)).toContain(
      'Usage: rush new --library <name> | rush new --project <name>',
    );
    expect(runContext.update).not.toHaveBeenCalled();
  });

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

describe('rush add-part', () => {
  beforeEach(async () => {
    expect(await run(['--project', 'notes-app'], context())).toBe(0);
  });

  it('adds a part, runs rush update and prints the next steps', async () => {
    const runContext = context();

    expect(await runAddPart(['--project', 'notes-app', '--part', 'node'], runContext)).toBe(0);
    expect(runContext.update).toHaveBeenCalledOnce();
    expect(await pathExists(root, 'projects/notes-app/src/api/server.ts')).toBe(true);
    expect(text(runContext.out)).toContain('Added the node part to @vprprudhvi/notes-app:');
    expect(text(runContext.out)).toContain('3. Run: rush verify --to @vprprudhvi/notes-app');
    expect(runContext.err).not.toHaveBeenCalled();
  });

  it.each([
    [['--project', 'notes-app']],
    [['--part', 'web']],
    [['--project', 'notes-app', '--part', 'web', '--other', 'x']],
    [['notes-app', 'web']],
  ])('fails with usage for %j', async (argv) => {
    const runContext = context();
    expect(await runAddPart(argv, runContext)).toBe(1);
    expect(text(runContext.err)).toContain(
      'Usage: rush add-part --project <name> --part <node|web|infra>',
    );
    expect(runContext.update).not.toHaveBeenCalled();
  });

  it('fails with the engine message and does not run rush update', async () => {
    const runContext = context();
    expect(await runAddPart(['--project', 'notes-app', '--part', 'api'], runContext)).toBe(1);
    expect(text(runContext.err)).toContain('unknown part "api". Use one of: node, web, infra');
    expect(runContext.update).not.toHaveBeenCalled();
  });

  it('returns the rush update exit code when it fails', async () => {
    const runContext = context(4);
    expect(await runAddPart(['--project', 'notes-app', '--part', 'web'], runContext)).toBe(4);
    expect(text(runContext.err)).toContain('rush add-part: rush update failed (exit 4)');
  });
});
