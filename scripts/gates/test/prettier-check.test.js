// Tests for the Prettier check (lib/prettier-check.mjs, prettier-check.mjs). The CLI runs against
// temp git repos with a stub prettier at the autoinstaller path: no real Prettier.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  BATCH_SIZE,
  fixCommand,
  handledPath,
  PRETTIER_BIN,
  selectFiles,
} from '../lib/prettier-check.mjs';

import { exec, GATES, makeRepository } from './harness.js';

const CLI = path.join(GATES, 'prettier-check.mjs');
const CALLS = 'common/temp/prettier-calls.log';

// The stub logs each call. A file with UNFORMATTED in it is listed (exit 1); a file with BROKEN in
// it is a syntax error (exit 2). Prettier's own exit codes.
const PRETTIER_STUB = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync('${CALLS}', JSON.stringify(args) + '\\n');
const files = args.slice(args.indexOf('--') + 1);
let status = 0;
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  if (text.includes('BROKEN')) {
    process.stderr.write('[error] ' + file + ': SyntaxError: stub\\n');
    process.exit(2);
  }
  if (text.includes('UNFORMATTED')) {
    process.stdout.write(file + '\\n');
    status = 1;
  }
}
process.exit(status);
`;

/** @typedef {ReturnType<typeof makeRepository>} Repository */

/**
 * @param {Repository} repository - Temp repo.
 * @param {string} [text] - Stub source.
 */
function installStub(repository, text = PRETTIER_STUB) {
  repository.write(PRETTIER_BIN, text);
  fs.chmodSync(path.join(repository.root, PRETTIER_BIN), 0o755);
}

/**
 * @param {Repository} repository - Temp repo.
 * @param {string} message - Commit message.
 */
function commitAll(repository, message) {
  repository.git('add', '-A');
  repository.git('commit', '-q', '-m', message);
}

/**
 * @param {Repository} repository - Temp repo.
 * @param {string[]} args - CLI arguments.
 * @param {Record<string, string>} [env] - Extra environment.
 * @returns {{ status: number, stdout: string, stderr: string }} Result.
 */
function runCli(repository, args, env = {}) {
  return exec(process.execPath, [CLI, ...args], {
    cwd: repository.root,
    env: { GATES_FULL: '', GATES_BASE: '', ...env },
  });
}

/**
 * @param {Repository} repository - Temp repo.
 * @returns {string[][]} The argument lists that the stub got.
 */
function stubCalls(repository) {
  const text = repository.read(CALLS) ?? '';
  return text
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line));
}

describe('prettier-check: handled paths', () => {
  /** @type {[string, boolean][]} */
  const table = [
    ['src/a.ts', true],
    ['web/page.tsx', true],
    ['scripts/x.mjs', true],
    ['.lintstagedrc.cjs', true],
    ['package.json', true],
    ['tsconfig.jsonc', true],
    ['.github/workflows/ci.yml', true],
    ['config.yaml', true],
    ['web/styles.css', true],
    ['docs/README.md', true],
    ['docs/UPPER.MD', true],
    ['app/main.py', false],
    ['cmd/main.go', false],
    ['scripts/run.sh', false],
    ['bruno/get.bru', false],
    ['Makefile', false],
  ];
  for (const [file, expected] of table) {
    it(`${file} -> ${String(expected)}`, () => {
      assert.equal(handledPath(file), expected);
    });
  }

  it('quotes each file in the fix command', () => {
    assert.equal(fixCommand(['a.md', "it's.md"]), `${PRETTIER_BIN} --write 'a.md' 'it'\\''s.md'`);
  });
});

describe('prettier-check: file selection', () => {
  /** @type {Repository} */
  let repository;
  /** @type {string} */
  let base;

  beforeEach(() => {
    repository = makeRepository({
      '.prettierignore': 'generated/\n**/bruno/\n',
      'docs/keep.md': '# keep\n',
      'docs/old-name.md': '# old\n',
      'docs/gone.md': '# gone\n',
      'src/b.ts': 'export const b = 1;\n',
    });
    base = repository.git('rev-parse', 'HEAD').trim();
  });

  afterEach(() => {
    repository.remove();
  });

  it('keeps changed and added files and drops ignored, deleted, unhandled and old rename paths', () => {
    repository.write('src/b.ts', 'export const b = 2;\n');
    repository.write('docs/new.md', '# new\n');
    repository.write('generated/out.ts', 'export {};\n');
    repository.write('projects/x/bruno/docs.md', '# bruno\n');
    repository.write('app/main.py', 'print(1)\n');
    repository.git('rm', '-q', 'docs/gone.md');
    repository.git('mv', 'docs/old-name.md', 'docs/new-name.md');
    commitAll(repository, 'change');

    assert.deepEqual(selectFiles({ root: repository.root, base, full: false }), [
      'docs/new-name.md',
      'docs/new.md',
      'src/b.ts',
    ]);
  });

  it('drops a renamed file when the new name is ignored', () => {
    repository.git('mv', 'docs/old-name.md', 'generated/old-name.md');
    commitAll(repository, 'rename');

    assert.deepEqual(selectFiles({ root: repository.root, base, full: false }), []);
  });

  it('drops symlinks', () => {
    fs.symlinkSync('keep.md', path.join(repository.root, 'docs', 'AGENTS.md'));
    commitAll(repository, 'link');

    assert.deepEqual(selectFiles({ root: repository.root, base, full: false }), []);
  });

  it('drops files that the root .gitignore matches, like Prettier does', () => {
    repository.write('.gitignore', `${repository.read('.gitignore') ?? ''}lib/\n`);
    repository.write('test/lib/a.test.ts', 'export {};\n');
    repository.git('add', '-f', 'test/lib/a.test.ts');
    commitAll(repository, 'gitignored');

    assert.deepEqual(selectFiles({ root: repository.root, base, full: false }), []);
  });

  it('checks only committed changes: a file changed in the working tree only is not selected', () => {
    repository.write('docs/keep.md', '# changed, not committed\n');

    assert.deepEqual(selectFiles({ root: repository.root, base, full: false }), []);
  });

  it('full mode selects every tracked handled file that is not ignored', () => {
    repository.write('generated/out.ts', 'export {};\n');
    repository.write('app/main.py', 'print(1)\n');
    fs.symlinkSync('keep.md', path.join(repository.root, 'docs', 'AGENTS.md'));
    commitAll(repository, 'more');

    assert.deepEqual(selectFiles({ root: repository.root, base, full: true }), [
      'common/scripts/install-run-rush.js',
      'docs/gone.md',
      'docs/keep.md',
      'docs/old-name.md',
      'packages/a/package.json',
      'packages/a/src/a.ts',
      'rush.json',
      'src/b.ts',
    ]);
  });
});

describe('prettier-check: CLI', () => {
  /** @type {Repository} */
  let repository;
  /** @type {string} */
  let base;

  beforeEach(() => {
    repository = makeRepository({
      '.prettierignore': 'common/scripts/\n',
      'docs/keep.md': '# keep\n',
    });
    installStub(repository);
    base = repository.git('rev-parse', 'HEAD').trim();
  });

  afterEach(() => {
    repository.remove();
  });

  it('passes with no changed files and does not call Prettier', () => {
    const result = runCli(repository, ['--base', base]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^prettier: pass \(0 files\)$/m);
    assert.deepEqual(stubCalls(repository), []);
  });

  it('passes and counts the changed files', () => {
    repository.write('docs/keep.md', '# keep it\n');
    repository.write('src/c.ts', 'export const c = 1;\n');
    commitAll(repository, 'change');

    const result = runCli(repository, ['--base', base]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^prettier: pass \(2 files\)$/m);
    assert.deepEqual(stubCalls(repository), [
      ['--list-different', '--', 'docs/keep.md', 'src/c.ts'],
    ]);
  });

  it('fails, lists the unformatted files, and prints the fix command', () => {
    repository.write('docs/keep.md', '# UNFORMATTED\n');
    repository.write('src/c.ts', 'export const c = 1;\n');
    commitAll(repository, 'change');

    const result = runCli(repository, ['--base', base]);

    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /prettier: FAIL 1 of 2 files are not formatted:\n {2}docs\/keep\.md\n/,
    );
    assert.ok(result.stderr.includes(`${PRETTIER_BIN} --write 'docs/keep.md'`), result.stderr);
    assert.doesNotMatch(result.stdout, /prettier: pass/);
  });

  it('GATES_FULL=1 checks every tracked file, also the unchanged ones', () => {
    repository.write('docs/keep.md', '# UNFORMATTED\n');
    commitAll(repository, 'drift');

    const result = runCli(repository, ['--base', 'HEAD'], { GATES_FULL: '1' });

    assert.equal(result.status, 1);
    assert.match(result.stdout, /prettier: checking 4 files \(all tracked files: GATES_FULL=1\)/);
    assert.match(result.stderr, /^ {2}docs\/keep\.md$/m);
    const files = stubCalls(repository).flatMap((args) => args.slice(2));
    assert.deepEqual(files, [
      'docs/keep.md',
      'packages/a/package.json',
      'packages/a/src/a.ts',
      'rush.json',
    ]);
  });

  it('GATES_FULL=1 passes on a clean repo with no change since the base', () => {
    const result = runCli(repository, ['--base', 'HEAD'], { GATES_FULL: '1' });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^prettier: pass \(4 files\)$/m);
  });

  it('splits a long file list into batches', () => {
    const count = BATCH_SIZE + 5;
    for (let index = 0; index < count; index += 1) {
      repository.write(`docs/many/f${String(index).padStart(3, '0')}.md`, '# f\n');
    }
    commitAll(repository, 'many');

    const result = runCli(repository, ['--base', base]);

    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes(`prettier: pass (${String(count)} files)\n`), result.stdout);
    assert.deepEqual(
      stubCalls(repository).map((args) => args.length - 2),
      [BATCH_SIZE, 5],
    );
  });

  it('fails when Prettier exits 2 (a syntax error), and never reports a pass', () => {
    repository.write('src/bad.ts', 'BROKEN\n');
    commitAll(repository, 'bad');

    const result = runCli(repository, ['--base', base]);

    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /prettier: FAIL prettier exited 2:\n\[error\] src\/bad\.ts: SyntaxError/,
    );
    assert.doesNotMatch(result.stdout, /prettier: pass/);
  });

  it('fails when Prettier exits 1 with no file names', () => {
    installStub(repository, '#!/usr/bin/env node\nprocess.exit(1);\n');
    repository.write('src/c.ts', 'export const c = 1;\n');
    commitAll(repository, 'change');

    const result = runCli(repository, ['--base', base]);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /prettier: FAIL prettier exited 1/);
  });

  it('fails when the Prettier binary is missing, also with no changed files', () => {
    fs.rmSync(path.join(repository.root, PRETTIER_BIN));

    const result = runCli(repository, ['--base', base]);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /prettier: FAIL the Prettier binary is missing at /);
    assert.match(result.stderr, /install-autoinstaller --name rush-lint-staged/);
  });

  it('exits 2 for a base that git cannot find, and for a bad argument', () => {
    const missing = runCli(repository, ['--base', 'no-such-ref']);
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /prettier: no base: Bad revision "no-such-ref"/);

    const bad = runCli(repository, ['--nope']);
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /bad argument: --nope/);
  });
});
