// Tests for lib/failure-logs.mjs, keep-failure-logs.mjs and the Stop hook: a failed step copies the
// rush-logs and test-results folders to .claude/state/failure-logs/<UTC time>-<step>/, keeps the
// newest 10 folders, and names the folder in its message. The runner (local-gates.sh) is tested in
// gates-base.test.js.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  FAILURE_LOGS_FOLDER,
  KEEP_COUNT,
  keepFailureLogs,
  keepFailureLogsNote,
  logFolders,
  stepSlug,
  utcStamp,
} from '../lib/failure-logs.mjs';

import { callHook, exec, GATES, makeRepository } from './harness.js';

const CLI = path.join(GATES, 'keep-failure-logs.mjs');
const TIME = new Date('2026-10-23T10:11:12.345Z');
const KEPT_LINE =
  /Logs kept in (\.claude\/state\/failure-logs\/\d{8}T\d{6}Z-[a-z0-9-]+)\. Read them before you rerun\./;

/**
 * Writes a file and its parent folders.
 *
 * @param {string} root - Base folder.
 * @param {string} name - Path from the base folder.
 * @param {string} text - Content.
 * @returns {void}
 */
function write(root, name, text) {
  fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
  fs.writeFileSync(path.join(root, name), text);
}

/**
 * Reads a file, or null when it is missing.
 *
 * @param {string} root - Base folder.
 * @param {string} name - Path from the base folder.
 * @returns {string | null} The text.
 */
function read(root, name) {
  const file = path.join(root, name);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

/**
 * Lists the kept folders.
 *
 * @param {string} root - Repo root.
 * @returns {string[]} Folder names, sorted.
 */
function kept(root) {
  const folder = path.join(root, FAILURE_LOGS_FOLDER);
  return fs.existsSync(folder) ? fs.readdirSync(folder).sort() : [];
}

describe('failure log names', () => {
  it('writes the time as a UTC stamp', () => {
    assert.equal(utcStamp(TIME), '20261023T101112Z');
    assert.equal(utcStamp(new Date('2026-01-02T03:04:05Z')), '20260102T030405Z');
  });

  it('makes a slug of the step name', () => {
    assert.equal(
      stepSlug('rush verify --impacted-by git:abc123'),
      'rush-verify-impacted-by-git-abc123',
    );
    assert.equal(stepSlug('stop lint: @t/a'), 'stop-lint-t-a');
    assert.equal(stepSlug(''), 'step');
    assert.equal(stepSlug('!!!'), 'step');
    const long = stepSlug(`${'word '.repeat(30)}end`);
    assert.ok(long.length <= 60, long);
    assert.match(long, /^[a-z0-9-]+$/);
    assert.doesNotMatch(long, /^-|-$|--/);
  });
});

describe('failure log folders', () => {
  /** @type {string} */
  let root;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gates-failure-logs-')));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('lists the rush-logs and test-results folders that exist', () => {
    write(root, 'projects/p/rush-logs/p.build.log', 'build');
    write(root, 'projects/p/test-results/r.txt', 'result');
    write(root, 'packages/a/rush-logs/a.log', 'a');
    write(root, 'packages/a/test-results/no.txt', 'only projects keep test-results');
    write(root, 'platform/infra/rush-logs/i.log', 'i');
    write(root, 'tooling/t/rush-logs/t.log', 't');
    write(root, 'projects/r/rush-logs', 'a file, not a folder');
    write(root, 'elsewhere/x/rush-logs/x.log', 'not a project parent');
    fs.mkdirSync(path.join(root, 'projects', 'q'));
    fs.symlinkSync(path.join(root, 'elsewhere'), path.join(root, 'projects', 'q', 'rush-logs'));
    assert.deepEqual(logFolders(root), [
      'projects/p/rush-logs',
      'projects/p/test-results',
      'packages/a/rush-logs',
      'platform/infra/rush-logs',
      'tooling/t/rush-logs',
    ]);
  });

  it('copies each folder with its path from the root, and writes failure.txt', () => {
    write(root, 'projects/p/rush-logs/p.build.log', 'build failed here');
    write(root, 'projects/p/test-results/home/trace.txt', 'trace');
    write(root, 'packages/a/rush-logs/a.log', 'a log');
    const folder = keepFailureLogs(root, { step: 'rush verify', report: 'exit 1', now: TIME });
    assert.equal(folder, `${FAILURE_LOGS_FOLDER}/20261023T101112Z-rush-verify`);
    assert.equal(read(root, `${folder}/projects/p/rush-logs/p.build.log`), 'build failed here');
    assert.equal(read(root, `${folder}/projects/p/test-results/home/trace.txt`), 'trace');
    assert.equal(read(root, `${folder}/packages/a/rush-logs/a.log`), 'a log');
    const summary = read(root, `${folder}/failure.txt`) ?? '';
    assert.match(summary, /^Step: rush verify\n/);
    assert.match(summary, /Time \(UTC\): 2026-10-23T10:11:12\.345Z/);
    assert.match(
      summary,
      /- projects\/p\/rush-logs\n- projects\/p\/test-results\n- packages\/a\/rush-logs/,
    );
    assert.match(summary, /Report:\nexit 1\n$/);
  });

  it('keeps the evidence when a rerun writes new logs', () => {
    write(root, 'packages/a/rush-logs/a.log', 'first run');
    const first = keepFailureLogs(root, { step: 'rush verify', now: TIME });
    write(root, 'packages/a/rush-logs/a.log', 'second run');
    const second = keepFailureLogs(root, { step: 'rush verify', now: TIME });
    assert.equal(second, `${first}-2`);
    assert.equal(read(root, `${first}/packages/a/rush-logs/a.log`), 'first run');
    assert.equal(read(root, `${second}/packages/a/rush-logs/a.log`), 'second run');
  });

  it('writes failure.txt when no log folder exists', () => {
    const folder = keepFailureLogs(root, { step: 'opengrep', now: TIME });
    assert.match(
      read(root, `${folder}/failure.txt`) ?? '',
      /No rush-logs or test-results folder existed\./,
    );
  });

  it('copies a symbolic link as a link, and does not follow it', () => {
    write(root, 'secret.txt', 'outside the log folder');
    write(root, 'packages/a/rush-logs/a.log', 'a');
    fs.symlinkSync('../../../secret.txt', path.join(root, 'packages', 'a', 'rush-logs', 'link'));
    const folder = keepFailureLogs(root, { step: 'x', now: TIME });
    const copy = path.join(root, folder, 'packages', 'a', 'rush-logs', 'link');
    assert.ok(fs.lstatSync(copy).isSymbolicLink());
    assert.equal(fs.readlinkSync(copy), '../../../secret.txt');
  });

  it(`keeps the newest ${String(KEEP_COUNT)} folders and leaves other files alone`, () => {
    write(root, `${FAILURE_LOGS_FOLDER}/notes/keep.txt`, 'not a kept folder');
    const made = [];
    for (let minute = 0; minute < KEEP_COUNT + 2; minute += 1) {
      const now = new Date(Date.UTC(2026, 9, 23, 10, minute, 0));
      made.push(path.posix.basename(keepFailureLogs(root, { step: 'gate tests', now })));
    }
    assert.deepEqual(kept(root), [...made.slice(2), 'notes'].sort());
    assert.equal(read(root, `${FAILURE_LOGS_FOLDER}/notes/keep.txt`), 'not a kept folder');
  });

  it('never removes the new folder, even when its time is older', () => {
    for (let minute = 0; minute < KEEP_COUNT; minute += 1) {
      keepFailureLogs(root, { step: 'late', now: new Date(Date.UTC(2026, 9, 23, 11, minute, 0)) });
    }
    const early = keepFailureLogs(root, { step: 'early', now: TIME });
    assert.ok(kept(root).includes(path.posix.basename(early)));
    assert.equal(kept(root).length, KEEP_COUNT);
  });

  it('gives the kept line, or the reason, and never throws', () => {
    write(root, 'packages/a/rush-logs/a.log', 'a');
    assert.match(keepFailureLogsNote(root, { step: 'lint', now: TIME }), KEPT_LINE);
    fs.rmSync(path.join(root, FAILURE_LOGS_FOLDER), { recursive: true });
    write(root, FAILURE_LOGS_FOLDER, 'a file where the folder must be');
    const note = keepFailureLogsNote(root, { step: 'lint', now: TIME });
    assert.match(note, /^The failure logs were not kept: /);
  });
});

describe('keep-failure-logs CLI', () => {
  /** @type {ReturnType<typeof makeRepository>} */
  let repository;

  beforeEach(() => {
    repository = makeRepository();
  });

  afterEach(() => {
    repository.remove();
  });

  it('keeps the logs and prints where they are', () => {
    repository.write('packages/a/rush-logs/a.test.log', 'test output');
    const result = exec('node', [CLI, '--step', 'gate tests', '--note', 'exit 1'], {
      cwd: path.join(repository.root, 'packages', 'a'),
    });
    assert.equal(result.status, 0, result.stderr);
    const match = KEPT_LINE.exec(result.stdout);
    assert.ok(match, result.stdout);
    const folder = match[1] ?? '';
    assert.match(folder, /-gate-tests$/);
    assert.equal(repository.read(`${folder}/packages/a/rush-logs/a.test.log`), 'test output');
    assert.match(repository.read(`${folder}/failure.txt`) ?? '', /Step: gate tests[\s\S]*exit 1/);
  });

  it('needs --step, and rejects other arguments', () => {
    assert.equal(exec('node', [CLI], { cwd: repository.root }).status, 2);
    assert.equal(exec('node', [CLI, '--step'], { cwd: repository.root }).status, 2);
    assert.equal(exec('node', [CLI, '--bogus', 'x'], { cwd: repository.root }).status, 2);
    assert.deepEqual(kept(repository.root), []);
  });
});

describe('Stop hook keeps the failure logs', () => {
  /** @type {ReturnType<typeof makeRepository>} */
  let repository;

  beforeEach(() => {
    repository = makeRepository();
    repository.write('common/temp/stub-fail', '1');
    repository.write('packages/a/rush-logs/a.lint.log', 'lint log of the failed run');
    repository.write('packages/a/src/a.ts', 'export const value = 2;\n');
  });

  afterEach(() => {
    repository.remove();
  });

  it('names the kept folder before the footer of the block message', () => {
    const result = callHook(
      'stop-gate',
      { hookEventName: 'Stop', stopHookActive: false },
      { root: repository.root },
    );
    assert.equal(result.status, 2);
    const match = KEPT_LINE.exec(result.stderr);
    assert.ok(match, result.stderr);
    const folder = match[1] ?? '';
    assert.match(folder, /-stop-lint-t-a$/);
    assert.match(result.stderr, /Read them before you rerun\.\n\nFix the cause\./);
    assert.match(result.stderr, /then stop again\.\n?$/);
    assert.equal(
      repository.read(`${folder}/packages/a/rush-logs/a.lint.log`),
      'lint log of the failed run',
    );
    assert.match(repository.read(`${folder}/failure.txt`) ?? '', /stub lint failure/);
  });

  it('keeps one folder for each failed stop', () => {
    const stop = () =>
      callHook(
        'stop-gate',
        { hookEventName: 'Stop', stopHookActive: true },
        { root: repository.root },
      );
    assert.equal(stop().status, 2);
    assert.equal(stop().status, 2);
    assert.equal(kept(repository.root).length, 2);
  });

  it('keeps the logs for --write-state-only (the verify skill)', () => {
    const result = callHook('stop-gate', null, {
      root: repository.root,
      args: ['--write-state-only'],
    });
    assert.equal(result.status, 1);
    const match = KEPT_LINE.exec(result.stderr);
    assert.ok(match, result.stderr);
    assert.match(match[1] ?? '', /-verify-lint-t-a$/);
  });
});
