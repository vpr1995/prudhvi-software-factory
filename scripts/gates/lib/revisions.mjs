import { git } from './proc.mjs';

/**
 * Checks that a revision names a commit, and turns it into a commit id. The id cannot act as a
 * git option, and it does not change while a script runs.
 *
 * @param {string} root - Repo root.
 * @param {string} revision - Revision text from the command line.
 * @returns {string} The commit id. It throws when git does not know the revision.
 */
export function resolveCommit(root, revision) {
  if (revision === '' || revision.startsWith('-')) {
    throw new Error(
      `Bad revision "${revision}": it must name a commit and must not start with "-".`,
    );
  }
  const found = git(root, [
    'rev-parse',
    '--verify',
    '--quiet',
    '--end-of-options',
    `${revision}^{commit}`,
  ]);
  if (found.status !== 0 || found.stdout.trim() === '') {
    throw new Error(`Bad revision "${revision}": git cannot find that commit.`);
  }
  return found.stdout.trim();
}

/**
 * Finds the start of a PR range: the merge base of `base` and `head`, so commits that only `base`
 * has are not counted. Two histories with no common commit start at `base`.
 *
 * @param {string} root - Repo root.
 * @param {string} base - Base commit.
 * @param {string} head - Head commit.
 * @returns {string} The commit id of the start. It throws when git fails.
 */
export function mergeBase(root, base, head) {
  const merge = git(root, ['--no-optional-locks', 'merge-base', base, head]);
  if (merge.status === 0 && merge.stdout.trim() !== '') {
    return merge.stdout.trim();
  }
  if (merge.status !== 1) {
    throw new Error(
      `git merge-base ${base} ${head} failed (exit ${String(merge.status)}): ${merge.stderr.trim().slice(0, 300)}`,
    );
  }
  return base;
}
