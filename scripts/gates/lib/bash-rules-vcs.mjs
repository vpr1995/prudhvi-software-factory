// guard-bash rules for commands that bring in changes from somewhere else (patches, archives,
// merges, stashes and restores). They are blocked when the incoming change touches a gate file.
import path from 'node:path';

import { gateHitForWord } from './bash-paths.mjs';
import { checkStash } from './bash-rules-stash.mjs';
import { readText } from './fs-io.mjs';
import { findGate, isInProtectedFolder, unlockText } from './gate-list.mjs';
import { git, run } from './proc.mjs';
import { programName } from './shell-parse.mjs';

/**
 * @typedef {import('./shell-parse.mjs').Segment} Segment
 * @typedef {import('./bash-paths.mjs').PathScope} PathScope
 */

const MAX_STRIPPED_COMPONENTS = 4;
const READ_ONLY_APPLY_FLAGS = new Set(['--check', '--stat', '--numstat', '--summary']);
const ARCHIVE_EXTRACT = /^-[a-zA-Z]*x|^--extract$|^--get$/;
const PROTECTED_REMOTE_BRANCHES = ['origin/main', 'origin/master', 'origin/trunk'];

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
 * Reads the two paths of a `diff --git a/x b/y` header.
 *
 * @param {string} rest - The header text after `diff --git `.
 * @returns {string[]} The old and the new path (the whole text when it has no `b/` part).
 */
function diffHeaderPaths(rest) {
  const split = /\s"?b\//.exec(rest);
  if (split === null) {
    return [rest];
  }
  const before = rest
    .slice(0, split.index)
    .replace(/^"?a\//, '')
    .replace(/"$/, '');
  const after = rest.slice(split.index + split[0].length).replace(/"$/, '');
  return [before, after];
}

/**
 * Lists the paths that a unified diff or mailbox patch changes.
 *
 * @param {string} text - Patch text.
 * @returns {string[]} The paths as written in the patch.
 */
export function patchPaths(text) {
  const found = new Set();
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      for (const name of diffHeaderPaths(line.slice('diff --git '.length))) {
        found.add(name);
      }
      continue;
    }
    const other = /^(?:---|\+\+\+|rename from|rename to|copy from|copy to)\s+(?:[ab]\/)?(\S+)/.exec(
      line,
    );
    if (other !== null && other[1] !== '/dev/null') {
      found.add(other[1] ?? '');
    }
  }
  found.delete('');
  return [...found];
}

/**
 * Gives every reading of a patch path: with 0 to 4 leading folders cut (`-p0` to `-p4`).
 *
 * @param {string} patchPath - A path from a patch.
 * @returns {string[]} The readings.
 */
function strippedReadings(patchPath) {
  const parts = patchPath.split('/');
  return Array.from({ length: MAX_STRIPPED_COMPONENTS + 1 }, (_, count) =>
    parts.slice(count).join('/'),
  ).filter((reading) => reading !== '');
}

/**
 * Finds a gate file that a patch changes.
 *
 * @param {string} text - Patch text.
 * @param {PathScope} scope - Scope.
 * @returns {string | null} The gate path, or null.
 */
function gateInPatch(text, scope) {
  for (const patchPath of patchPaths(text)) {
    for (const reading of strippedReadings(patchPath)) {
      const hit = gateHitForWord(reading, scope);
      if (hit !== null) {
        return hit.relative;
      }
    }
  }
  return null;
}

/**
 * Reads a file named in a command, trying each working folder.
 *
 * @param {string} name - File name from the command.
 * @param {PathScope} scope - Scope.
 * @returns {string | null} The text, or null when the file cannot be read.
 */
function readNamedFile(name, scope) {
  for (const cwd of scope.cwds) {
    const text = readText(path.resolve(cwd, name));
    if (text !== null) {
      return text;
    }
  }
  return null;
}

/**
 * Collects the patch texts a command gets: file operands, `<` redirects, `-i` files, stdin text.
 *
 * @param {Segment} segment - A `patch` or `git apply` command.
 * @param {string[]} files - File operands.
 * @param {PathScope} scope - Scope.
 * @returns {{ texts: string[], unreadable: string[] }} The texts, and the names that could not be read.
 */
function collectPatchTexts(segment, files, scope) {
  const names = [
    ...files,
    ...segment.redirects.filter((entry) => entry.op === '<').map((entry) => entry.target),
  ];
  const texts = [...segment.stdinTexts];
  const unreadable = [];
  for (const name of names) {
    const text = name === '-' ? null : readNamedFile(name, scope);
    if (text === null) {
      unreadable.push(name);
    } else {
      texts.push(text);
    }
  }
  return { texts, unreadable };
}

/**
 * Checks `patch` and `git apply`, `git am`.
 *
 * @param {Segment} segment - The command.
 * @param {{ files: string[], label: string }} input - File operands (patch files) and the command name for the message.
 * @param {PathScope} scope - Scope.
 * @returns {string | null} Reason, or null.
 */
export function checkPatchInput(segment, input, scope) {
  const { files, label } = input;
  const { texts, unreadable } = collectPatchTexts(segment, files, scope);
  if (texts.length === 0 && unreadable.length === 0) {
    return `${label} reads its patch from a pipe, so the guard cannot see which files it changes. Write the patch to a file under temp/ and run ${label} on that file, or ask the human.`;
  }
  if (unreadable.length > 0) {
    return `${label} reads ${unreadable.join(', ')}, which the guard cannot read, so it cannot check which files the patch changes. Use a patch file in the repo or temp/.`;
  }
  for (const text of texts) {
    const gate = gateInPatch(text, scope);
    if (gate !== null) {
      return `${label} would change ${gate}, which is a gate file. ${unlockText()}`;
    }
  }
  return null;
}

/**
 * Checks `patch` (the program).
 *
 * @param {Segment} segment - The command.
 * @param {PathScope} scope - Scope.
 * @returns {string | null} Reason, or null.
 */
function checkPatchProgram(segment, scope) {
  const words = segment.argv.slice(1);
  const inputFlagIndex = words.findIndex((word) => word === '-i' || word === '--input');
  const inputFiles = [];
  if (inputFlagIndex !== -1) {
    inputFiles.push(words[inputFlagIndex + 1] ?? '');
  }
  for (const word of words) {
    if (word.startsWith('--input=')) {
      inputFiles.push(word.slice('--input='.length));
    }
  }
  return checkPatchInput(segment, { files: inputFiles, label: 'patch' }, scope);
}

/**
 * Lists the member paths of an archive.
 *
 * @param {string} program - `tar` or `unzip`.
 * @param {string} archive - Archive file.
 * @returns {string[] | null} Member paths, or null when the archive cannot be listed.
 */
function archiveMembers(program, archive) {
  const result =
    program === 'unzip' ? run('unzip', ['-Z1', archive]) : run('tar', ['-tf', archive]);
  return result.status === 0 ? result.stdout.split('\n').filter((line) => line !== '') : null;
}

/**
 * Finds the archive file and the extraction folders in the words of `tar` or `unzip`.
 *
 * @param {string} name - `tar` or `unzip`.
 * @param {string[]} words - Arguments.
 * @returns {{ archive: string, folders: string[] }} The archive name (empty when none) and folders.
 */
function readExtractionWords(name, words) {
  const folderFlags = name === 'tar' ? ['-C', '--directory'] : ['-d'];
  const folders = [];
  let archive = '';
  for (const [index, word] of words.entries()) {
    const next = words[index + 1] ?? '';
    if (folderFlags.includes(word)) {
      folders.push(next);
    } else if (word.startsWith('--directory=')) {
      folders.push(word.slice('--directory='.length));
    } else if (name === 'tar' && (word === '--file' || word === '-f')) {
      archive = next;
    } else if (name === 'tar' && word.startsWith('--file=')) {
      archive = word.slice('--file='.length);
    } else if (name === 'tar' && index === 0 && /^-?[a-zA-Z]*f[a-zA-Z]*$/.test(word)) {
      archive = next;
    } else if (
      name === 'tar' &&
      /^-[a-zA-Z]+$/.test(word) &&
      word.includes('f') &&
      archive === ''
    ) {
      archive = next;
    } else if (name === 'unzip' && /\.zip$/i.test(word)) {
      archive = word;
    }
  }
  return { archive, folders };
}

/**
 * Checks `tar -x` and `unzip`: the extraction folder and the member paths.
 *
 * @param {Segment} segment - The command.
 * @param {PathScope} scope - Scope.
 * @returns {string | null} Reason, or null.
 */
function checkExtraction(segment, scope) {
  const name = programName(segment);
  const words = segment.argv.slice(1);
  const extracts =
    name === 'unzip'
      ? !words.some((word) => ['-l', '-t', '-Z', '-v', '-p'].includes(word))
      : words.some(
          (word, index) => ARCHIVE_EXTRACT.test(word) || (index === 0 && /^[a-zA-Z]*x/.test(word)),
        );
  if (!extracts) {
    return null;
  }
  const { archive, folders } = readExtractionWords(name, words);
  const members = archive === '' ? null : archiveMembers(name, archive);
  for (const base of folders.length > 0 ? folders : ['.']) {
    const reason = extractionReason({ name, members }, base, scope);
    if (reason !== null) {
      return reason;
    }
  }
  return null;
}

/**
 * Checks one extraction folder of `tar` or `unzip`.
 *
 * @param {{ name: string, members: string[] | null }} archive - `tar` or `unzip`, and the member paths (null when the archive cannot be listed).
 * @param {string} base - Extraction folder.
 * @param {PathScope} scope - Scope.
 * @returns {string | null} Reason, or null.
 */
function extractionReason(archive, base, scope) {
  const { name, members } = archive;
  if (members === null) {
    const baseHit = gateHitForWord(base, scope);
    return baseHit === null
      ? null
      : `${name} extracts into ${baseHit.relative}, which holds gate files, and the guard cannot list the archive. Extract into temp/ with -C and review the files. ${unlockText()}`;
  }
  for (const member of members) {
    const hit = gateHitForWord(path.posix.join(base, member), scope);
    if (hit !== null) {
      return `${name} would extract ${hit.relative}, which is a gate file. ${unlockText()}`;
    }
  }
  return null;
}

/**
 * Lists the gate files that differ between the working tree and a source.
 *
 * @param {string} root - Repo root.
 * @param {string[]} args - Extra `git diff` arguments (revs, `--cached`).
 * @param {string} [pathspec] - Folder or file from the repo root.
 * @returns {string[]} Gate file paths.
 */
function gateDifferences(root, args, pathspec = '') {
  const paths = pathspec === '' || pathspec === '.' ? [] : [pathspec];
  const result = git(root, ['diff', '--name-only', '-z', '--no-renames', ...args, '--', ...paths]);
  return result.stdout
    .split('\0')
    .filter((file) => file !== '')
    .filter((file) => isGateFile(file));
}

/**
 * Tells whether a revision is a commit.
 *
 * @param {string} root - Repo root.
 * @param {string} rev - Text that may name a commit.
 * @returns {boolean} True when it resolves to a commit.
 */
function isRevision(root, rev) {
  return (
    !rev.startsWith('-') &&
    git(root, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${rev}^{commit}`])
      .status === 0
  );
}

/**
 * Tells whether a commit is already on the remote main branch (a human approved it).
 *
 * @param {string} root - Repo root.
 * @param {string} rev - A commit.
 * @returns {boolean} True when the commit is an ancestor of origin/main.
 */
function isOnRemoteMain(root, rev) {
  return PROTECTED_REMOTE_BRANCHES.some(
    (branch) =>
      isRevision(root, branch) &&
      git(root, ['merge-base', '--is-ancestor', rev, branch]).status === 0,
  );
}

/**
 * Checks what a merge, cherry-pick, rebase or pull brings in.
 *
 * @param {string} root - Repo root.
 * @param {string} sub - Git subcommand.
 * @param {string[]} args - Arguments after the subcommand.
 * @returns {string | null} Reason, or null.
 */
function checkIncomingChanges(root, sub, args) {
  if (args.some((word) => ['--abort', '--quit', '--skip', '--continue'].includes(word))) {
    return null;
  }
  const candidates = args.filter((word) => !word.startsWith('-'));
  const revisions = candidates.filter((word) => isRevision(root, word));
  if (sub === 'pull' && revisions.length === 0 && isRevision(root, '@{upstream}')) {
    revisions.push('@{upstream}');
  }
  const ranges = candidates.filter((word) => word.includes('..') && !isRevision(root, word));
  const changed = [
    ...revisions
      .filter((rev) => !isOnRemoteMain(root, rev))
      .flatMap((rev) =>
        sub === 'cherry-pick'
          ? gateDifferences(root, [`${rev}~1`, rev])
          : gateDifferences(root, [`HEAD...${rev}`]),
      ),
    ...ranges.flatMap((range) => gateDifferences(root, [range])),
  ];
  return changed.length === 0
    ? null
    : `git ${sub} would change ${changed[0] ?? ''}, which is a gate file (not yet on origin/main). Ask the human to run it. ${unlockText()}`;
}

/**
 * Checks `git apply` and `git am`.
 *
 * @param {Segment} segment - The command.
 * @param {{ sub: string, args: string[] }} parsed - `apply` or `am`, and the arguments after it.
 * @param {PathScope} scope - Scope.
 * @returns {string | null} Reason, or null.
 */
function checkApply(segment, parsed, scope) {
  const { sub, args } = parsed;
  if (args.some((word) => READ_ONLY_APPLY_FLAGS.has(word))) {
    return null;
  }
  if (
    sub === 'am' &&
    args.some((word) => ['--abort', '--quit', '--skip', '--continue'].includes(word))
  ) {
    return null;
  }
  const valueFlags = new Set(['-p', '-C', '--directory', '--include', '--exclude', '--whitespace']);
  const files = [];
  for (let index = 0; index < args.length; index += 1) {
    const word = args[index] ?? '';
    if (valueFlags.has(word)) {
      index += 1;
    } else if (!word.startsWith('-') || word === '-') {
      files.push(word);
    }
  }
  return checkPatchInput(segment, { files, label: `git ${sub}` }, scope);
}

/**
 * Checks the version-control commands that bring in other changes.
 *
 * @param {Segment} segment - A `git` command (with its parsed parts).
 * @param {{ sub: string, args: string[] }} parsed - Parsed git command.
 * @param {PathScope} scope - Scope, with `cwds` already moved by `git -C`.
 * @returns {string | null} Reason, or null.
 */
export function checkIncomingGit(segment, parsed, scope) {
  switch (parsed.sub) {
    case 'apply':
    case 'am': {
      return checkApply(segment, parsed, scope);
    }
    case 'merge':
    case 'cherry-pick':
    case 'rebase':
    case 'pull': {
      return checkIncomingChanges(scope.root, parsed.sub, parsed.args);
    }
    case 'stash': {
      return checkStash(scope, parsed.args);
    }
    default: {
      return null;
    }
  }
}

/**
 * Checks `patch`, `tar -x` and `unzip`.
 *
 * @param {Segment} segment - A simple command.
 * @param {PathScope} scope - Scope.
 * @returns {string | null} Reason, or null.
 */
export function checkIncomingFiles(segment, scope) {
  const name = programName(segment);
  if (name === 'patch') {
    return checkPatchProgram(segment, scope);
  }
  return name === 'tar' || name === 'unzip' ? checkExtraction(segment, scope) : null;
}

/**
 * Lists the gate files that a restore of a folder or the whole tree would change.
 *
 * @param {string} root - Repo root.
 * @param {string} relative - Folder or file from the repo root (`.` for the root).
 * @param {string[]} sourceArgs - `git diff` arguments for the source (a rev, or nothing for the index).
 * @returns {string[]} Gate file paths.
 */
export function gateChangesUnder(root, relative, sourceArgs) {
  return gateDifferences(root, sourceArgs, relative);
}

/**
 * Tells whether text names a commit in this repo.
 *
 * @param {string} root - Repo root.
 * @param {string} rev - Text.
 * @returns {boolean} True when it resolves.
 */
export function resolvesToCommit(root, rev) {
  return isRevision(root, rev);
}
