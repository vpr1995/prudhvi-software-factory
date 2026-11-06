// Repo helpers for the stop gate: source files, Rush projects, git state and file hashes.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';

import { readBytes, readOptional, readRepositoryFile } from './fs-io.mjs';
import { parseJsonc } from './jsonc.mjs';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const SOURCE_ROOTS = new Set(['projects', 'packages', 'platform', 'tooling']);
const SKIPPED_FOLDERS = new Set(['node_modules', 'dist', '.next', 'coverage', 'cdk.out']);

/** @typedef {import('./stop-gate-command.mjs').Project} Project */

/**
 * @param {string} file - Repo-relative path.
 * @returns {boolean} True for a source file that the gate checks.
 */
export function isSourceFile(file) {
  const parts = file.split('/');
  return (
    SOURCE_ROOTS.has(parts[0] ?? '') &&
    SOURCE_EXTENSIONS.has(path.extname(file)) &&
    !parts.some((part) => SKIPPED_FOLDERS.has(part))
  );
}

/**
 * @param {string} root - Repo root.
 * @returns {Project[]} Rush projects with their workspace dependencies.
 */
export function loadProjects(root) {
  /** @type {{ projects?: { packageName: string, projectFolder: string }[] }} */
  const rush = parseJsonc(readRepositoryFile(root, 'rush.json'));
  const entries = rush.projects ?? [];
  const names = new Set(entries.map((entry) => entry.packageName));
  return entries.map(({ packageName, projectFolder }) => {
    const manifestText = readOptional(path.join(root, projectFolder, 'package.json'));
    /** @type {Record<string, Record<string, string> | undefined>} */
    const manifest = manifestText ? JSON.parse(manifestText) : {};
    const dependencies = [manifest.dependencies, manifest.devDependencies]
      .flatMap((group) => Object.keys(group ?? {}))
      .filter((name) => names.has(name));
    return { packageName, projectFolder, dependencies };
  });
}

/**
 * @param {Project[]} projects - Rush projects.
 * @param {string} file - Repo-relative path.
 * @returns {Project | undefined} The project with the longest folder that holds the file.
 */
export function owningProject(projects, file) {
  return projects
    .filter((project) => file.startsWith(`${project.projectFolder}/`))
    .toSorted((a, b) => b.projectFolder.length - a.projectFolder.length)[0];
}

/**
 * @param {string} root - Repo root.
 * @param {string[]} args - git arguments.
 * @returns {{ ok: boolean, stdout: string, stderr: string }} The result.
 */
export function git(root, args) {
  // Only the ignore rules of the repo count, never the global excludes file of the user.
  const result = spawnSync('git', ['-c', 'core.excludesFile=/dev/null', ...args], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const ok = !result.error && result.status === 0;
  return { ok, stdout: result.stdout ?? '', stderr: String(result.error ?? result.stderr) };
}

/**
 * @param {string} root - Repo root.
 * @returns {{ changed: Set<string>, untracked: Set<string> }} Paths that git status shows:
 *   modified, added, renamed or untracked, and not ignored. Deleted files are not in the sets.
 */
function gitStatus(root) {
  const result = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (!result.ok) {
    throw new Error(`git status failed: ${result.stderr}`);
  }
  const entries = result.stdout.split('\0');
  const changed = new Set();
  const untracked = new Set();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] ?? '';
    if (entry.length < 4) {
      continue;
    }
    const status = entry.slice(0, 2);
    if (status[0] === 'R' || status[0] === 'C') {
      index += 1; // The next entry is the old path.
    }
    if (!status.includes('D')) {
      changed.add(entry.slice(3));
    }
    if (status === '??') {
      untracked.add(entry.slice(3));
    }
  }
  return { changed, untracked };
}

/**
 * @param {string} root - Repo root.
 * @param {string} base - Commit.
 * @returns {Set<string>} Tracked paths whose working tree content differs from the commit.
 */
function diffFrom(root, base) {
  const result = git(root, ['diff', '--name-only', '--no-renames', '-z', base, '--']);
  if (!result.ok) {
    throw new Error(`git diff ${base} failed: ${result.stderr}`);
  }
  return new Set(result.stdout.split('\0').filter((file) => file !== ''));
}

/**
 * Files that differ from the session base: the gate checks these. A file with the same content
 * as the session base is unchanged, also when git status shows it (after a commit) or not
 * (after a stash).
 *
 * @param {string} root - Repo root.
 * @param {string | undefined} base - Session base commit, or undefined.
 * @returns {Set<string>} Repo-relative paths.
 */
export function changedFromBase(root, base) {
  const status = gitStatus(root);
  if (!base) {
    return status.changed;
  }
  return new Set([...diffFrom(root, base), ...status.untracked]);
}

/**
 * The files to hash around a Bash command: git status plus the changes since the session base.
 *
 * @param {string} root - Repo root.
 * @param {string | undefined} base - Session base commit, or undefined.
 * @returns {Set<string>} Repo-relative paths.
 */
export function candidateFiles(root, base) {
  const { changed } = gitStatus(root);
  return base ? new Set([...changed, ...diffFrom(root, base)]) : changed;
}

/**
 * @param {string} root - Repo root.
 * @param {string} file - Repo-relative path.
 * @returns {string} sha256 of the content, hex.
 */
export function hashFile(root, file) {
  return createHash('sha256')
    .update(readBytes(path.join(root, file)))
    .digest('hex');
}
