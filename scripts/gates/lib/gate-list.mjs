import path from 'node:path';

import gateFiles from '../gate-files.json' with { type: 'json' };

import { realPath } from './fs-io.mjs';
import { firstMatch, normalizeForMatch } from './glob.mjs';

/**
 * @typedef {object} PushExemption
 * @property {string} path - One literal repo path, such as `common/config/rush/pnpm-lock.yaml`.
 * @property {'agent-if-lock-clean' | 'agent-with-clean-lock' | 'agent-if-projects-added'} push - How push-exempt.mjs checks the content. `agent-if-lock-clean`: the new lock passes the lock lint (pnpm-lock.yaml). `agent-with-clean-lock`: only together with such a lock change (repo-state.json). `agent-if-projects-added`: the change adds register-project.mjs entries to the `projects` array and nothing else (rush.json).
 * @property {string} why - Short reason.
 */

const PUSH_MODES = new Set([
  'agent-if-lock-clean',
  'agent-with-clean-lock',
  'agent-if-projects-added',
]);
const WILDCARD = /[*?[\]{}]/;

/**
 * Turns a file path into paths from the repo root. A path gives two answers when a symbolic
 * link is involved: the path as written and the real path. Check both.
 *
 * @param {string} root - Repo root (absolute).
 * @param {string} base - Folder that relative paths start from.
 * @param {string} file - File path from the tool input or the command.
 * @returns {string[]} Repo-relative paths with forward slashes. Empty when the path is outside the repo.
 */
export function repositoryRelativeCandidates(root, base, file) {
  const absolute = path.resolve(base, file);
  const candidates = [
    path.relative(root, absolute),
    path.relative(realPath(root), realPath(absolute)),
  ];
  const inside = candidates.filter(
    (relative) => relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative),
  );
  return [...new Set(inside.map((relative) => relative.split(path.sep).join('/')))];
}

/**
 * Turns a file path into a path from the repo root.
 *
 * @param {string} root - Repo root (absolute).
 * @param {string} base - Folder that relative paths start from.
 * @param {string} file - File path from the tool input or the command.
 * @returns {string | null} Repo-relative path, or null when outside the repo.
 */
export function toRepositoryRelative(root, base, file) {
  return repositoryRelativeCandidates(root, base, file)[0] ?? null;
}

/**
 * The gate list as data.
 *
 * @returns {{ glob: string, why: string }[]} The entries of gate-files.json.
 */
export function gateEntries() {
  return gateFiles.gates;
}

/**
 * The text that tells a human how to unlock a gate file.
 *
 * @returns {string} The unlock text.
 */
export function unlockText() {
  return gateFiles.unlock;
}

/**
 * Folders whose files a Bash command must not change (hooks).
 *
 * @returns {string[]} Folder paths from the repo root.
 */
export function writeProtectedFolders() {
  return gateFiles.writeProtectedForBash;
}

/**
 * Anti-skip scanner settings from gate-files.json.
 *
 * @returns {{ ignorePaths: string[], coverageOnlyPaths: string[] }} Settings.
 */
export function antiSkipSettings() {
  return gateFiles.antiSkip;
}

/**
 * The gate files that an agent may push (the `pushExempt` list of gate-files.json). Such a file is
 * still a gate file for every other check: the edit hook, the deny rules, the Stop integrity
 * check, the CI risk label and CODEOWNERS do not read this list. Only the push guard does.
 *
 * @returns {PushExemption[]} The entries of the `pushExempt` list.
 */
export function pushExemptEntries() {
  return /** @type {PushExemption[]} */ (gateFiles.pushExempt);
}

/**
 * Finds the push exemption of a path. The match is an exact, case-sensitive compare with a literal
 * path (never a glob). It does not look at the glob list, so a broader gate entry that matches the
 * same file (such as `common/config/rush/**`) cannot change the answer. An entry with an unknown
 * `push` value, a wildcard in its path, or a path that is not a gate file never matches.
 *
 * @param {string} relativePath - Path from the repo root, exactly as git writes it.
 * @returns {PushExemption | null} The entry, or null when an agent may not push a change of this file.
 */
export function pushExemption(relativePath) {
  const entry = pushExemptEntries().find((candidate) => candidate.path === relativePath);
  if (entry === undefined || !PUSH_MODES.has(entry.push) || WILDCARD.test(entry.path)) {
    return null;
  }
  return findGate(relativePath) === null ? null : entry;
}

/**
 * Finds the gate entry for a repo-relative path.
 *
 * @param {string} relativePath - Path from the repo root.
 * @returns {{ glob: string, why: string } | null} The entry, or null when the path is not a gate file.
 */
export function findGate(relativePath) {
  const normalized = normalizeForMatch(relativePath);
  const matched = firstMatch(
    normalized,
    gateFiles.gates.map((entry) => entry.glob),
  );
  return gateFiles.gates.find((entry) => entry.glob === matched) ?? null;
}

/**
 * Tells whether a repo-relative path is a protected folder file (hook folders).
 *
 * @param {string} relativePath - Path from the repo root.
 * @returns {boolean} True when the path is inside a write-protected folder.
 */
export function isInProtectedFolder(relativePath) {
  const normalized = normalizeForMatch(relativePath);
  return gateFiles.writeProtectedForBash.some(
    (folder) => normalized === folder || normalized.startsWith(`${folder}/`),
  );
}
