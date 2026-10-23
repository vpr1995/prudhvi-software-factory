// The base commit of the local gate run (scripts/gates/local-gates.sh). Every diff-based check
// (anti-skip, check-gates, test-impacted, rush verify --impacted-by) compares with this commit.
//
// Order (the first one that exists wins):
//   1. env      GATES_BASE (a human override). Set but unknown: error.
//   2. origin   the merge base of origin/main and HEAD.
//   3. upstream the merge base of the upstream of the current branch and HEAD.
//   4. state    the commit in .claude/state/gates-base. Present but unknown: error.
//   5. root     the root commit of HEAD. The runner then runs the full `rush verify`.
// A set value that git does not know never falls through to the next source: that would move
// the base without a word.
import path from 'node:path';

import { readText } from './fs-io.mjs';
import { statePaths } from './git-state.mjs';
import { git } from './proc.mjs';
import { mergeBase, resolveCommit } from './revisions.mjs';

/** @typedef {'env' | 'origin' | 'upstream' | 'state' | 'root'} BaseSource */

/**
 * @typedef {object} GatesBase
 * @property {string} sha - The base commit id.
 * @property {BaseSource} source - Where the base came from.
 * @property {string} detail - The ref or file behind the base, for the log line.
 */

/**
 * The path of the stored base file.
 *
 * @param {string} root - Repo root.
 * @returns {string} Absolute path of `.claude/state/gates-base`.
 */
export function gatesBaseFile(root) {
  return path.join(statePaths(root).directory, 'gates-base');
}

/**
 * Turns a ref into a commit id when the ref exists.
 *
 * @param {string} root - Repo root.
 * @param {string} ref - A ref such as `origin/main`.
 * @returns {string} The commit id, or an empty string when git does not know the ref.
 */
function optionalCommit(root, ref) {
  const found = git(root, [
    'rev-parse',
    '--verify',
    '--quiet',
    '--end-of-options',
    `${ref}^{commit}`,
  ]);
  return found.status === 0 ? found.stdout.trim() : '';
}

/**
 * Finds the upstream of the current branch.
 *
 * @param {string} root - Repo root.
 * @returns {string} The upstream ref (for example `origin/feature`), or an empty string.
 */
function upstreamRef(root) {
  const found = git(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
  return found.status === 0 ? found.stdout.trim() : '';
}

/**
 * Finds the root commit of HEAD. With more than one root (merged histories), the oldest one.
 *
 * @param {string} root - Repo root.
 * @returns {string} The commit id. It throws when HEAD has no commit.
 */
function rootCommit(root) {
  const listed = git(root, ['rev-list', '--max-parents=0', 'HEAD']);
  const roots = listed.stdout.split('\n').filter((line) => line.trim() !== '');
  const oldest = roots.at(-1);
  if (listed.status !== 0 || oldest === undefined) {
    throw new Error('HEAD has no commit, so the gates have no base. Make a first commit.');
  }
  return oldest.trim();
}

/**
 * Picks the base commit of the local gate run.
 *
 * @param {string} root - Repo root.
 * @param {{ envBase?: string }} [options] - `envBase`: the value of GATES_BASE (empty or missing: not set).
 * @returns {GatesBase} The base. It throws when a set value is not a commit.
 */
export function resolveGatesBase(root, options = {}) {
  const head = resolveCommit(root, 'HEAD');
  const envBase = options.envBase?.trim() ?? '';
  if (envBase !== '') {
    try {
      return { sha: resolveCommit(root, envBase), source: 'env', detail: `GATES_BASE=${envBase}` };
    } catch (caught) {
      throw new Error(
        `GATES_BASE is set, but it is not a commit: ${caught instanceof Error ? caught.message : String(caught)} Fix or unset GATES_BASE.`,
        { cause: caught },
      );
    }
  }
  const origin = optionalCommit(root, 'origin/main');
  if (origin !== '') {
    return { sha: mergeBase(root, origin, head), source: 'origin', detail: 'origin/main' };
  }
  const upstream = upstreamRef(root);
  const upstreamSha = upstream === '' ? '' : optionalCommit(root, upstream);
  if (upstreamSha !== '') {
    return { sha: mergeBase(root, upstreamSha, head), source: 'upstream', detail: upstream };
  }
  const file = gatesBaseFile(root);
  const stored = readText(file)?.trim() ?? '';
  if (stored !== '') {
    try {
      return {
        sha: resolveCommit(root, stored),
        source: 'state',
        detail: '.claude/state/gates-base',
      };
    } catch (caught) {
      throw new Error(
        `.claude/state/gates-base holds "${stored}", and that is not a commit. Fix or delete the file.`,
        { cause: caught },
      );
    }
  }
  return { sha: rootCommit(root), source: 'root', detail: 'root commit' };
}

/**
 * The log line of the base.
 *
 * @param {GatesBase} base - The base.
 * @returns {string} `gates: base <sha> (<source>: <detail>)`.
 */
export function formatBase(base) {
  return `gates: base ${base.sha} (${base.source}: ${base.detail})`;
}
