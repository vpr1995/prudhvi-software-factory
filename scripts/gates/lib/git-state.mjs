import crypto from 'node:crypto';
import path from 'node:path';

import {
  exists,
  makeTemporaryDirectory,
  readJson,
  readText,
  removePath,
  writeText,
} from './fs-io.mjs';
import { STOP_ATTEMPT_LIMIT } from './gates.config.mjs';
import { git, gitOrThrow } from './proc.mjs';

/** The id of the empty tree object. Git knows it in every repo, so a repo with no commit can diff against it. */
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const MAIN_BRANCHES = ['origin/main', 'origin/master', 'main', 'master'];

/**
 * Finds the repo root.
 *
 * @param {string} start - Any folder inside the repo.
 * @returns {string} The absolute repo root, or `start` when it is not a git repo.
 */
export function repositoryRoot(start) {
  const result = git(start, ['rev-parse', '--show-toplevel']);
  return result.status === 0 ? result.stdout.trim() : start;
}

/**
 * Gets the paths of the agent state files.
 *
 * @param {string} root - Repo root.
 * @returns {{ directory: string, lastVerify: string, sessionBase: string, stopAttempts: string, subagentAttempts: string }} Paths.
 */
export function statePaths(root) {
  const directory = path.join(root, '.claude', 'state');
  return {
    directory,
    lastVerify: path.join(directory, 'last-verify.json'),
    sessionBase: path.join(directory, 'session-base'),
    stopAttempts: path.join(directory, 'stop-attempts'),
    subagentAttempts: path.join(directory, 'subagent-stop-attempts'),
  };
}

/**
 * Gets the HEAD commit.
 *
 * @param {string} root - Repo root.
 * @returns {string} The sha, or an empty string when there is no commit.
 */
export function headSha(root) {
  const result = git(root, ['rev-parse', '--verify', '--quiet', 'HEAD']);
  return result.status === 0 ? result.stdout.trim() : '';
}

/**
 * Gets the current branch name.
 *
 * @param {string} root - Repo root.
 * @returns {string} Branch name, or an empty string when HEAD is detached.
 */
export function currentBranch(root) {
  const result = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const name = result.stdout.trim();
  return result.status === 0 && name !== 'HEAD' ? name : '';
}

/**
 * Finds where this branch left the main branch.
 *
 * @param {string} root - Repo root.
 * @returns {string} The merge-base commit, or an empty string when there is none.
 */
function mainMergeBase(root) {
  for (const branch of MAIN_BRANCHES) {
    if (git(root, ['rev-parse', '--verify', '--quiet', `${branch}^{commit}`]).status === 0) {
      const base = git(root, ['merge-base', 'HEAD', branch]);
      if (base.status === 0 && base.stdout.trim() !== '') {
        return base.stdout.trim();
      }
    }
  }
  return '';
}

/**
 * Reads the commit saved at session start. When the file is missing or the commit is unknown, the
 * base is where the branch left main (so a deleted file does not shrink the scan), or HEAD.
 *
 * @param {string} root - Repo root.
 * @returns {string} A commit sha, or the empty tree when the repo has no commit.
 */
export function sessionBase(root) {
  const saved = readText(statePaths(root).sessionBase)?.trim() ?? '';
  if (saved !== '' && git(root, ['cat-file', '-e', `${saved}^{commit}`]).status === 0) {
    return saved;
  }
  return mainMergeBase(root) || headSha(root) || EMPTY_TREE;
}

/**
 * Lists the paths that changed since a commit, in the working tree.
 *
 * @param {string} root - Repo root.
 * @param {string} base - Commit to compare with.
 * @returns {{ present: string[], deleted: string[], all: string[] }} Changed paths from the repo root.
 *   `present` holds added, modified and untracked files. `deleted` holds removed files.
 */
export function changedSince(root, base) {
  const tracked = gitOrThrow(root, [
    'diff',
    '--name-status',
    '-z',
    '--no-renames',
    '--no-ext-diff',
    base,
    '--',
  ]);
  const fields = tracked.stdout.split('\0').filter((field) => field !== '');
  const present = [];
  const deleted = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const status = fields[index] ?? '';
    const file = fields[index + 1] ?? '';
    (status.startsWith('D') ? deleted : present).push(file);
  }
  const untracked = gitOrThrow(root, ['ls-files', '--others', '--exclude-standard', '-z']);
  present.push(...untracked.stdout.split('\0').filter((field) => field !== ''));
  return { present, deleted, all: [...present, ...deleted] };
}

/**
 * Computes the tree hash. It is the sha256 of the HEAD sha, `git diff HEAD`, and the untracked
 * files with the blob hash of each.
 *
 * @param {string} root - Repo root.
 * @returns {string} Hex digest.
 */
export function treeHash(root) {
  const head = headSha(root);
  const diff = gitOrThrow(root, [
    'diff',
    '--no-ext-diff',
    '--no-color',
    '--binary',
    head || EMPTY_TREE,
    '--',
  ]);
  const listing = gitOrThrow(root, ['ls-files', '--others', '--exclude-standard', '-z']);
  const names = listing.stdout
    .split('\0')
    .filter((name) => name !== '')
    .sort();
  const blobs = gitOrThrow(root, ['hash-object', '--stdin-paths'], { input: names.join('\n') });
  const blobLines = blobs.stdout.split('\n');
  const entries = names.map((name, index) => `${name} ${blobLines[index] ?? ''}`);
  return crypto
    .createHash('sha256')
    .update([head, diff.stdout, ...entries].join('\n--\n'))
    .digest('hex');
}

/**
 * Computes the content hash: the `git write-tree` hash of the working tree (tracked and untracked
 * files, ignored files left out). It does not change when the same content is committed.
 *
 * @param {string} root - Repo root.
 * @returns {string} Tree sha. It throws when git fails.
 */
export function contentHash(root) {
  const scratch = makeTemporaryDirectory('gate-index-');
  try {
    const indexFile = path.join(scratch, 'index');
    const env = { GIT_INDEX_FILE: indexFile };
    if (headSha(root) !== '') {
      gitOrThrow(root, ['read-tree', 'HEAD'], { env });
    }
    gitOrThrow(root, ['add', '--all', '--', '.'], { env });
    return gitOrThrow(root, ['write-tree'], { env }).stdout.trim();
  } finally {
    removePath(scratch);
  }
}

/**
 * Reads the verify state file.
 *
 * @param {string} root - Repo root.
 * @returns {Record<string, unknown> | null} The state, or null when missing.
 */
export function readVerifyState(root) {
  const value = readJson(statePaths(root).lastVerify);
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : null;
}

/**
 * Tells whether the state file says `pass` for the current tree.
 *
 * @param {string} root - Repo root.
 * @param {{ allowSkips?: boolean }} [options] - `allowSkips` also accepts `pass-with-skips`
 *   (a required scanner did not run). The stop gate accepts it. Push and PR creation do not.
 * @returns {{ ok: boolean, reason: string }} The answer and a reason for a refusal.
 */
export function verifyIsCurrent(root, options = {}) {
  const state = readVerifyState(root);
  if (state === null) {
    return { ok: false, reason: 'no .claude/state/last-verify.json exists' };
  }
  if (state['status'] === 'pass-with-skips' && options.allowSkips !== true) {
    return {
      ok: false,
      reason: `the last verify skipped a required scanner (${String(state['summary'])}). Install the missing tool and verify again`,
    };
  }
  if (
    state['status'] !== 'pass' &&
    !(options.allowSkips === true && state['status'] === 'pass-with-skips')
  ) {
    return {
      ok: false,
      reason: `the last verify did not pass (status: ${String(state['status'])})`,
    };
  }
  const same = state['treeHash'] === treeHash(root) || state['contentHash'] === contentHash(root);
  return same
    ? { ok: true, reason: '' }
    : { ok: false, reason: 'the working tree changed after the last passing verify' };
}

/**
 * Reads an attempt counter file.
 *
 * @param {string} file - Counter file.
 * @returns {number} The count (0 when missing).
 */
export function readCounter(file) {
  const parsed = Number.parseInt(readText(file)?.trim() ?? '0', 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Writes an attempt counter file. A zero removes the file.
 *
 * @param {string} file - Counter file.
 * @param {number} count - New count.
 * @returns {void}
 */
export function writeCounter(file, count) {
  if (count === 0) {
    removePath(file);
    return;
  }
  writeText(file, `${String(count)}\n`);
}

/**
 * Tells whether the loop-guard limit is reached.
 *
 * @param {number} count - Blocked stops so far.
 * @returns {boolean} True when the next stop must pass.
 */
export function limitReached(count) {
  return count > STOP_ATTEMPT_LIMIT;
}

/**
 * Tells whether the repo has the Rush install marker.
 *
 * @param {string} root - Repo root.
 * @returns {boolean} True when `common/temp` exists.
 */
export function rushInstalled(root) {
  return exists(path.join(root, 'common', 'temp'));
}
