// guard-bash rule for `git stash`. A push sets aside the tracked changes under its pathspecs. It
// takes untracked gate files only with `-u` or `-a`.
import { findGate, isInProtectedFolder } from './gate-list.mjs';
import { git, run } from './proc.mjs';

/** @typedef {import('./bash-paths.mjs').PathScope} PathScope */

const STASH_ACTIONS = new Set([
  'push',
  'save',
  'list',
  'show',
  'pop',
  'apply',
  'drop',
  'clear',
  'branch',
  'create',
  'store',
]);
const VALUE_FLAGS = new Set(['-m', '--message', '--pathspec-from-file']);
const SHORT_GROUP = /^-[a-zA-Z]+$/;

/**
 * Tells whether a repo path is a gate file.
 *
 * @param {string} relative - Repo path.
 * @returns {boolean} True for a gate file or a file in a protected folder.
 */
function isGateFile(relative) {
  return findGate(relative) !== null || isInProtectedFolder(relative);
}

/**
 * Reads a group of short flags such as `-uq` or `-um` (in a group, `m` ends the flags: the rest of
 * the word is the message, or the next word when `m` is last).
 *
 * @param {string} word - The group, with its dash.
 * @returns {{ untracked: boolean, ignored: boolean, takesNext: boolean }} What the group sets.
 */
function readShortGroup(word) {
  const flags = word.slice(1).split('m')[0] ?? '';
  return {
    untracked: /[ua]/.test(flags),
    ignored: flags.includes('a'),
    takesNext: word.endsWith('m'),
  };
}

/**
 * Reads one flag word.
 *
 * @param {string} word - A word that starts with a dash.
 * @returns {{ skip: number, untracked: boolean, ignored: boolean }} The words to skip after it,
 *   and whether it turns on `-u` and `-a`.
 */
function readFlag(word) {
  if (VALUE_FLAGS.has(word)) {
    return { skip: 1, untracked: false, ignored: false };
  }
  if (word === '--include-untracked' || word === '--all') {
    return { skip: 0, untracked: true, ignored: word === '--all' };
  }
  if (SHORT_GROUP.test(word)) {
    const group = readShortGroup(word);
    return { skip: group.takesNext ? 1 : 0, untracked: group.untracked, ignored: group.ignored };
  }
  return { skip: 0, untracked: false, ignored: false };
}

/**
 * Reads the arguments of `git stash`.
 *
 * @param {string[]} args - Arguments after `stash`.
 * @returns {{ action: string, pathspecs: string[], untracked: boolean, ignored: boolean }} The action
 *   (`push` when none is named), the pathspecs, whether `-u` or `-a` is on, and whether `-a` is on.
 */
function parseStash(args) {
  const found = { action: '', untracked: false, ignored: false };
  const operands = [];
  const marker = args.indexOf('--');
  const flagWords = marker === -1 ? args : args.slice(0, marker);
  for (let index = 0; index < flagWords.length; index += 1) {
    const word = flagWords[index] ?? '';
    const flag = readFlag(word);
    found.untracked = found.untracked || flag.untracked;
    found.ignored = found.ignored || flag.ignored;
    index += flag.skip;
    if (word.startsWith('-')) {
      continue;
    }
    if (found.action === '' && STASH_ACTIONS.has(word)) {
      found.action = word;
    } else {
      operands.push(word);
    }
  }
  const action = found.action === '' ? 'push' : found.action;
  const afterMarker = marker === -1 ? [] : args.slice(marker + 1);
  return {
    ...found,
    action,
    pathspecs: action === 'push' ? [...operands, ...afterMarker] : afterMarker,
  };
}

/**
 * Lists the gate files that a stash push would set aside.
 *
 * @param {PathScope} scope - Scope.
 * @param {{ pathspecs: string[], untracked: boolean, ignored: boolean }} parsed - Parsed stash arguments.
 * @returns {string[]} Gate file paths.
 */
function gateFilesInStash(scope, parsed) {
  const { pathspecs } = parsed;
  // A pathspec is relative to the folder the command runs in, so try each possible folder.
  const folders = pathspecs.length === 0 ? [scope.root] : [...new Set([scope.root, ...scope.cwds])];
  const listings = folders.flatMap((folder) => {
    const tracked = git(folder, [
      'diff',
      '--name-only',
      '-z',
      '--no-renames',
      'HEAD',
      '--',
      ...pathspecs,
    ]);
    const exclude = parsed.ignored ? [] : ['--exclude-standard'];
    const others = parsed.untracked
      ? git(folder, ['ls-files', '-z', '--others', '--full-name', ...exclude, '--', ...pathspecs])
      : { stdout: '' };
    return [tracked.stdout, others.stdout];
  });
  const files = listings.flatMap((text) => text.split('\0')).filter((file) => file !== '');
  return [...new Set(files.filter((file) => isGateFile(file)))];
}

/**
 * Checks `git stash`.
 *
 * @param {PathScope} scope - Scope.
 * @param {string[]} args - Arguments after `stash`.
 * @returns {string | null} Reason, or null.
 */
export function checkStash(scope, args) {
  const parsed = parseStash(args);
  const { action } = parsed;
  if (['list', 'show', 'create', 'store', 'drop', 'clear'].includes(action)) {
    return null;
  }
  if (action === 'push' || action === 'save') {
    const edits = gateFilesInStash(scope, parsed);
    return edits.length === 0
      ? null
      : `git stash would set aside your changes to ${edits[0] ?? ''}, which is a gate file. Only a human changes gate files.`;
  }
  const names = run(
    'git',
    ['stash', 'show', '--name-only', '-z', ...args.filter((word) => word.startsWith('stash@'))],
    { cwd: scope.root },
  );
  const gates = names.stdout.split('\0').filter((file) => file !== '' && isGateFile(file));
  return gates.length === 0
    ? null
    : `git stash ${action} would change ${gates[0] ?? ''}, which is a gate file. Ask the human.`;
}
