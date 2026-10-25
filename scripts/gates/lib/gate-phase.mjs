// Helpers of gate-integrity.mjs for the `_phase:*` scripts of a package.json. A change to one of these
// scripts counts as a gate change. This module reads git objects only. It has no state.
import { git, runBinary } from './proc.mjs';

/** Flags for every git call of the gate integrity check: no index lock, so a parallel git call is safe. */
export const GIT_FLAGS = ['--no-optional-locks'];
const PHASE_PREFIX = '_phase:';

/**
 * @typedef {object} GateChange
 * @property {string} file - Path from the repo root.
 * @property {string} change - `modified`, `deleted`, `added`, `new`, `staged`, `type`, `mode` or `phase-script`.
 * @property {string} [detail] - Extra text, for example `_phase:test changed`.
 */

/**
 * Reads files as they are stored in a commit or in the index, with one git call.
 *
 * @param {string} root - Repo root.
 * @param {string[]} specs - `<commit>:<path>` for a commit, `:<path>` for the index, or a blob id.
 * @returns {Map<string, string>} Spec to text. A spec that git does not know is not in the map.
 */
export function readBlobs(root, specs) {
  const texts = new Map();
  if (specs.length === 0) {
    return texts;
  }
  const result = runBinary('git', [...GIT_FLAGS, 'cat-file', '--batch'], {
    cwd: root,
    input: `${specs.join('\n')}\n`,
  });
  if (result.status !== 0) {
    throw new Error(
      `git cat-file --batch failed (exit ${String(result.status)}): ${result.stderr.trim().slice(0, 300)}`,
    );
  }
  let position = 0;
  for (const spec of specs) {
    const end = result.stdout.indexOf(10, position);
    if (end === -1) {
      throw new Error('git cat-file --batch gave a short answer');
    }
    const header = result.stdout.toString('utf8', position, end).split(' ');
    position = end + 1;
    if (header[1] === 'blob') {
      const size = Number.parseInt(header[2] ?? '', 10);
      texts.set(spec, result.stdout.toString('utf8', position, position + size));
      position += size + 1;
    }
  }
  return texts;
}

/**
 * Lists the package.json files that hold the text `_phase:` in a commit or in the index. A package.json
 * without that text has no phase script, so only these files need a closer look.
 *
 * @param {string} root - Repo root.
 * @param {string} source - A commit, or `--cached` for the index.
 * @returns {Set<string>} Paths from the repo root.
 */
export function phaseFiles(root, source) {
  const result = git(root, [
    ...GIT_FLAGS,
    'grep',
    '--no-color',
    '-l',
    '-z',
    '-F',
    ...(source === '--cached' ? ['--cached'] : []),
    '-e',
    PHASE_PREFIX,
    ...(source === '--cached' ? [] : [source]),
    '--',
    ':(glob)**/package.json',
  ]);
  if (result.status > 1) {
    throw new Error(
      `git grep failed (exit ${String(result.status)}): ${result.stderr.trim().slice(0, 300)}`,
    );
  }
  const prefix = source === '--cached' ? '' : `${source}:`;
  return new Set(
    result.stdout
      .split('\0')
      .filter((entry) => entry !== '')
      .map((entry) =>
        prefix !== '' && entry.startsWith(prefix) ? entry.slice(prefix.length) : entry,
      ),
  );
}

/**
 * Reads the `_phase:*` scripts of a package.json text.
 *
 * @param {string | null} text - The file text (null for a file that does not exist).
 * @returns {Map<string, string> | 'unreadable'} Script name to its JSON value. `unreadable` when the text is not JSON and it holds `_phase:`.
 */
function phaseScripts(text) {
  const scripts = new Map();
  if (text === null) {
    return scripts;
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text.includes(PHASE_PREFIX) ? 'unreadable' : scripts;
  }
  const declared = parsed !== null && typeof parsed === 'object' ? parsed['scripts'] : undefined;
  if (declared !== null && typeof declared === 'object') {
    for (const [name, value] of Object.entries(declared)) {
      if (name.startsWith(PHASE_PREFIX)) {
        scripts.set(name, JSON.stringify(value));
      }
    }
  }
  return scripts;
}

/**
 * Compares the `_phase:*` scripts of two package.json texts.
 *
 * @param {string | null} before - Old text (null when the file did not exist).
 * @param {string | null} after - New text (null when the file does not exist now).
 * @returns {string[]} One text for each script that was added, removed or changed.
 */
export function phaseDifferences(before, after) {
  if (before === after) {
    return [];
  }
  const oldScripts = phaseScripts(before);
  const newScripts = phaseScripts(after);
  if (oldScripts === 'unreadable' || newScripts === 'unreadable') {
    return ['package.json has _phase: scripts and cannot be read as JSON'];
  }
  const found = [];
  for (const [name, value] of newScripts) {
    if (!oldScripts.has(name)) {
      found.push(`${name} added`);
    } else if (oldScripts.get(name) !== value) {
      found.push(`${name} changed`);
    }
  }
  for (const name of oldScripts.keys()) {
    if (!newScripts.has(name)) {
      found.push(`${name} removed`);
    }
  }
  return found;
}

/**
 * Makes the changes for a package.json whose `_phase:*` scripts differ.
 *
 * @param {string} file - Path from the repo root.
 * @param {string | null} before - Old text.
 * @param {string | null} after - New text.
 * @returns {GateChange[]} One change for each script that differs.
 */
export function phaseChanges(file, before, after) {
  return phaseDifferences(before, after).map((detail) => ({
    file,
    change: 'phase-script',
    detail,
  }));
}
