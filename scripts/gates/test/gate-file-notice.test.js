// Tests for the warn-only gate-file notice of the pre-commit hook (gate-file-notice.mjs). It runs
// for real against temp git repos.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { formatNotice, stagedGateFiles } from '../gate-file-notice.mjs';

import { exec, GATES, makeRepository } from './harness.js';

const CLI = path.join(GATES, 'gate-file-notice.mjs');

describe('gate-file notice', () => {
  /** @type {ReturnType<typeof makeRepository>} */
  let repository;

  beforeEach(() => {
    repository = makeRepository({ 'tooling/old.json': '{}\n' });
  });

  afterEach(() => {
    repository.remove();
  });

  it('lists staged gate files that are added, changed and deleted, and nothing else', () => {
    repository.write('tooling/new.json', '{}\n');
    repository.write('rush.json', '{"projects":[]}\n');
    repository.write('packages/a/src/b.ts', 'export const b = 1;\n');
    repository.write('scripts/gates/unstaged.mjs', 'export {};\n');
    repository.git('add', 'tooling/new.json', 'rush.json', 'packages/a/src/b.ts');
    repository.git('rm', '-q', '.gitignore');
    const found = stagedGateFiles(repository.root);
    assert.deepEqual(
      found.map((entry) => [entry.change, entry.file, entry.glob]),
      [
        ['deleted', '.gitignore', '**/.gitignore'],
        ['changed', 'rush.json', 'rush.json'],
        ['added', 'tooling/new.json', 'tooling/**'],
      ],
    );
  });

  it('counts a staged rename as a deletion and an addition', () => {
    repository.git('mv', 'tooling/old.json', 'packages/a/old.json');
    assert.deepEqual(
      stagedGateFiles(repository.root).map((entry) => [entry.change, entry.file]),
      [['deleted', 'tooling/old.json']],
    );
  });

  it('formats nothing when no gate file is staged', () => {
    repository.write('packages/a/src/b.ts', 'export const b = 1;\n');
    repository.git('add', '-A');
    assert.deepEqual(stagedGateFiles(repository.root), []);
    assert.equal(formatNotice([]), '');
  });

  it('formats one line for each file, with the glob and the reason', () => {
    const text = formatNotice([
      { file: 'rush.json', change: 'changed', glob: 'rush.json', why: 'Rush project list.' },
    ]);
    assert.equal(
      text,
      [
        'pre-commit: NOTICE (warn only) 1 staged gate file:',
        '  changed rush.json  (rush.json: Rush project list.)',
        'pre-commit: a gate file change needs a human review (docs/standards/gates.md, section 6.1).',
        '',
      ].join('\n'),
    );
  });

  it('CLI prints the notice on stderr and exits 0', () => {
    repository.write('tooling/new.json', '{}\n');
    repository.git('add', '-A');
    const result = exec('node', [CLI, '--root', repository.root]);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
    assert.match(
      result.stderr,
      /NOTICE \(warn only\) 1 staged gate file:\n {2}added tooling\/new\.json/,
    );
  });

  it('CLI exits 0 with no output when no gate file is staged', () => {
    const result = exec('node', [CLI, '--root', repository.root]);
    assert.deepEqual([result.status, result.stdout, result.stderr], [0, '', '']);
  });

  it('CLI never blocks: outside a git repo and on bad usage it warns and exits 0', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-notice-'));
    try {
      const result = exec('node', [CLI, '--root', outside]);
      assert.equal(result.status, 0);
      assert.match(result.stderr, /could not list the staged gate files/);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
    const bad = exec('node', [CLI, '--bogus'], { cwd: repository.root });
    assert.equal(bad.status, 0);
    assert.match(bad.stderr, /unknown argument: --bogus/);
  });
});
