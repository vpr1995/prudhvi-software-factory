// Gate integrity: tells which gate files (see gate-files.json) differ from what git has committed.
//
// It does not trust command parsing, and it does not trust `.claude/state`. It looks at git objects
// and at the real files:
//   - uncommitted(root)       gate files that differ between HEAD and the working tree or the index,
//                             and gate files that exist on disk but not in HEAD (untracked or ignored).
//   - range(root, base, head) gate files that a commit range changes.
//   - pushRange(root)         the range that a push or a pull request would publish.
// A change to a `_phase:*` key in the `scripts` object of a package.json counts as a gate change.
// Any git failure throws, so a hook that calls this fails closed.
//
// A later CI script (check-gates) can import this module as it is.
import crypto from 'node:crypto';
import path from 'node:path';

import { inspectPath, readBytes, readLinkText, walkFiles } from './fs-io.mjs';
import { findGate, isInProtectedFolder } from './gate-list.mjs';
import { EMPTY_TREE, headSha, sessionBase } from './git-state.mjs';
import { git, gitOrThrow, runBinary } from './proc.mjs';

/**
 * @typedef {object} GateChange
 * @property {string} file - Path from the repo root.
 * @property {string} change - `modified`, `deleted`, `added`, `new`, `staged`, `type`, `mode` or `phase-script`.
 * @property {string} [detail] - Extra text, for example `_phase:test changed`.
 */

/** Folder names that hold generated or third-party files. They are never read. */
const SKIPPED_FOLDER_NAMES = new Set([
  '.git',
  'node_modules',
  '.venv',
  'venv',
  '__pycache__',
  '.pytest_cache',
  '.ruff_cache',
  '.mypy_cache',
  '.next',
  '.turbo',
  'cdk.out',
  'coverage',
  'dist',
  'rush-logs',
]);
/**
 * Folders (from the repo root) that tools write while they run. `.claude/state` holds the state of
 * the hooks. The hooks write it, git ignores it, and it is not trusted.
 */
const SKIPPED_FOLDER_PATHS = new Set(['.claude/state', 'common/temp']);
const GIT_FLAGS = ['--no-optional-locks'];
const PHASE_PREFIX = '_phase:';
const GATE_MESSAGE = 'Gate file changed. Revert it (git checkout -- <file>) or ask the human.';
const SYMLINK_MODE = '120000';
const EXECUTABLE_MODE = '100755';
const SUBMODULE_MODE = '160000';
const PUSH_BASE_REFS = ['@{upstream}', 'origin/main', 'origin/master'];

/**
 * Tells whether a repo path is a gate file.
 *
 * @param {string} relative - Path from the repo root.
 * @returns {boolean} True for a gate file or a file in a write-protected folder.
 */
function isGatePath(relative) {
  return findGate(relative) !== null || isInProtectedFolder(relative);
}

/**
 * Tells whether a path is a package.json.
 *
 * @param {string} relative - Path from the repo root.
 * @returns {boolean} True for a package.json at any depth.
 */
function isPackageJson(relative) {
  return relative === 'package.json' || relative.endsWith('/package.json');
}

/**
 * Hashes bytes the way git hashes a blob.
 *
 * @param {Uint8Array} bytes - File content.
 * @param {string} algorithm - `sha1` or `sha256` (the object format of the repo).
 * @returns {string} Hex digest.
 */
function blobHash(bytes, algorithm) {
  return crypto
    .createHash(algorithm)
    .update(`blob ${String(bytes.length)}\0`)
    .update(bytes)
    .digest('hex');
}

/**
 * Lists the files of a commit.
 *
 * @param {string} root - Repo root.
 * @param {string} commit - A commit.
 * @returns {Map<string, { mode: string, sha: string }>} Path to mode and blob id.
 */
function listTree(root, commit) {
  const result = gitOrThrow(root, [...GIT_FLAGS, 'ls-tree', '-r', '-z', '--full-tree', commit]);
  const files = new Map();
  for (const record of result.stdout.split('\0')) {
    const tab = record.indexOf('\t');
    if (tab === -1) {
      continue;
    }
    const [mode = '', , sha = ''] = record.slice(0, tab).split(' ');
    files.set(record.slice(tab + 1), { mode, sha });
  }
  return files;
}

/**
 * Reads files as they are stored in a commit or in the index, with one git call.
 *
 * @param {string} root - Repo root.
 * @param {string[]} specs - `<commit>:<path>` for a commit, `:<path>` for the index, or a blob id.
 * @returns {Map<string, string>} Spec to text. A spec that git does not know is not in the map.
 */
function readBlobs(root, specs) {
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
function phaseFiles(root, source) {
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
function phaseDifferences(before, after) {
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
function phaseChanges(file, before, after) {
  return phaseDifferences(before, after).map((detail) => ({
    file,
    change: 'phase-script',
    detail,
  }));
}

/**
 * Compares one file of HEAD with the working tree.
 *
 * @param {string} root - Repo root.
 * @param {string} file - Path from the repo root.
 * @param {{ mode: string, sha: string }} entry - Mode and blob id in HEAD.
 * @returns {string | null} `deleted`, `type`, `modified`, `mode`, or null when the file is the same.
 */
function compareWithHead(root, file, entry) {
  if (entry.mode === SUBMODULE_MODE) {
    return null;
  }
  const absolute = path.join(root, file);
  const info = inspectPath(absolute);
  if (info === null) {
    return 'deleted';
  }
  const algorithm = entry.sha.length === 64 ? 'sha256' : 'sha1';
  if (entry.mode === SYMLINK_MODE) {
    const target = info.kind === 'symlink' ? readLinkText(absolute) : null;
    if (target === null) {
      return 'type';
    }
    return blobHash(Buffer.from(target), algorithm) === entry.sha ? null : 'modified';
  }
  if (info.kind !== 'file') {
    return 'type';
  }
  const bytes = readBytes(absolute);
  if (bytes === null || blobHash(bytes, algorithm) !== entry.sha) {
    return 'modified';
  }
  return (entry.mode === EXECUTABLE_MODE) === info.executable ? null : 'mode';
}

/**
 * Finds the changes of HEAD files (gate files and package.json files) in the working tree.
 *
 * @param {string} root - Repo root.
 * @param {Map<string, { mode: string, sha: string }>} headFiles - Files of HEAD.
 * @returns {GateChange[]} Changes.
 */
function trackedChanges(root, headFiles) {
  const changes = [];
  const headPhase = headFiles.size === 0 ? new Set() : phaseFiles(root, headSha(root));
  const packages = [];
  for (const [file, entry] of headFiles) {
    const gate = isGatePath(file);
    const isPackage = isPackageJson(file);
    const difference = gate || isPackage ? compareWithHead(root, file, entry) : null;
    if (difference === null) {
      continue;
    }
    if (gate) {
      changes.push({ file, change: difference });
    }
    if (isPackage) {
      packages.push({
        file,
        spec: headPhase.has(file) ? entry.sha : '',
        deleted: difference === 'deleted',
      });
    }
  }
  return [...changes, ...packageChanges(root, packages)];
}

/**
 * Finds the `_phase:*` script changes of package.json files that differ from HEAD.
 *
 * @param {string} root - Repo root.
 * @param {{ file: string, spec: string, deleted: boolean }[]} packages - Changed package.json files, with the HEAD blob id (empty when HEAD has no `_phase:` key).
 * @returns {GateChange[]} Changes.
 */
function packageChanges(root, packages) {
  const blobs = readBlobs(
    root,
    packages.map((entry) => entry.spec).filter((spec) => spec !== ''),
  );
  return packages.flatMap((entry) => {
    const before = blobs.get(entry.spec) ?? null;
    const after = entry.deleted ? null : readFileText(root, entry.file);
    return phaseChanges(entry.file, before, after);
  });
}

/**
 * Reads a working-tree file as text.
 *
 * @param {string} root - Repo root.
 * @param {string} file - Path from the repo root.
 * @returns {string | null} The text, or null when the file cannot be read.
 */
function readFileText(root, file) {
  const bytes = readBytes(path.join(root, file));
  return bytes === null ? null : bytes.toString('utf8');
}

/**
 * Finds files on disk that are not in HEAD and that match a gate glob. It walks the file system, so
 * it also finds files that `.gitignore` or `.git/info/exclude` hide from git.
 *
 * @param {string} root - Repo root.
 * @param {Map<string, { mode: string, sha: string }>} headFiles - Files of HEAD.
 * @returns {GateChange[]} Changes.
 */
function untrackedChanges(root, headFiles) {
  const changes = [];
  const entries = walkFiles(root, {
    skipNames: SKIPPED_FOLDER_NAMES,
    skipPaths: SKIPPED_FOLDER_PATHS,
  });
  for (const entry of entries) {
    if (headFiles.has(entry.path)) {
      continue;
    }
    // A link to a folder can stand for every file below its path.
    const gate =
      isGatePath(entry.path) || (entry.kind === 'symlink-dir' && isGatePath(`${entry.path}/x`));
    if (gate) {
      changes.push({ file: entry.path, change: 'new' });
    }
    if (isPackageJson(entry.path)) {
      changes.push(...phaseChanges(entry.path, null, readFileText(root, entry.path)));
    }
  }
  return changes;
}

/**
 * Parses the output of `git diff --name-status -z --no-renames`.
 *
 * @param {string} output - The output.
 * @returns {{ status: string, file: string }[]} The entries.
 */
function parseNameStatus(output) {
  const fields = output.split('\0').filter((field) => field !== '');
  const entries = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    entries.push({ status: fields[index] ?? '', file: fields[index + 1] ?? '' });
  }
  return entries;
}

/**
 * Names the kind of change of a `git diff` status letter.
 *
 * @param {string} status - A status such as `M`, `A`, `D` or `T`.
 * @returns {string} The change name.
 */
function changeName(status) {
  const names = { A: 'added', D: 'deleted', M: 'modified', T: 'type' };
  return names[status.charAt(0)] ?? 'modified';
}

/**
 * Lists the package.json files with `_phase:` text on one side of a diff.
 *
 * @param {string} root - Repo root.
 * @param {string} side - A commit, `--cached` for the index, or `none`.
 * @returns {Set<string>} Paths.
 */
function phaseSide(root, side) {
  return side === 'none' ? new Set() : phaseFiles(root, side);
}

/**
 * Makes the `git show` argument for a file on one side of a diff.
 *
 * @param {string} side - A commit, or `--cached` for the index.
 * @param {string} file - Path from the repo root.
 * @returns {string} `<commit>:<path>` or `:<path>`.
 */
function blobSpec(side, file) {
  return side === '--cached' ? `:${file}` : `${side}:${file}`;
}

/**
 * Finds the gate changes between two sides that `git diff` can compare.
 *
 * @param {string} root - Repo root.
 * @param {{ args: string[], before: string, after: string, stagedName?: string }} side - The `git diff` arguments, and the old and new side (a commit, `--cached` for the index, or `none` for no commit).
 * @returns {GateChange[]} Changes.
 */
function diffChanges(root, side) {
  const result = gitOrThrow(root, [
    ...GIT_FLAGS,
    'diff',
    '--name-status',
    '-z',
    '--no-renames',
    '--no-ext-diff',
    ...side.args,
    '--',
  ]);
  const changes = [];
  const entries = parseNameStatus(result.stdout);
  const needsPhase = entries.some((entry) => isPackageJson(entry.file));
  const beforePhase = needsPhase ? phaseSide(root, side.before) : new Set();
  const afterPhase = needsPhase ? phaseSide(root, side.after) : new Set();
  const packages = [];
  for (const { status, file } of entries) {
    if (isGatePath(file)) {
      changes.push({ file, change: side.stagedName ?? changeName(status) });
    }
    if (isPackageJson(file)) {
      packages.push({
        file,
        before: beforePhase.has(file) ? blobSpec(side.before, file) : '',
        after: afterPhase.has(file) ? blobSpec(side.after, file) : '',
      });
    }
  }
  const blobs = readBlobs(
    root,
    packages.flatMap((entry) => [entry.before, entry.after]).filter((spec) => spec !== ''),
  );
  for (const entry of packages) {
    changes.push(
      ...phaseChanges(entry.file, blobs.get(entry.before) ?? null, blobs.get(entry.after) ?? null),
    );
  }
  return changes;
}

/**
 * Removes repeated changes and sorts them.
 *
 * @param {GateChange[]} changes - Changes.
 * @returns {GateChange[]} Sorted changes, one for each file, change and detail.
 */
function uniqueChanges(changes) {
  const unique = new Map(
    changes.map((entry) => [`${entry.file}\0${entry.change}\0${entry.detail ?? ''}`, entry]),
  );
  return [...unique.values()].sort(
    (left, right) => left.file.localeCompare(right.file) || left.change.localeCompare(right.change),
  );
}

/**
 * Lists the gate files that differ between HEAD and the working tree or the index. It includes
 * deleted files, renamed files (both paths), new files that match a gate glob (untracked, or hidden
 * by `.gitignore`), and changes to `_phase:*` scripts of a package.json.
 *
 * @param {string} root - Repo root.
 * @returns {GateChange[]} Changes, sorted by path. Empty when all gate files are as committed. It throws when git fails.
 */
export function uncommitted(root) {
  const head = headSha(root);
  const headFiles = head === '' ? new Map() : listTree(root, head);
  const indexChanges = diffChanges(root, {
    args: ['--cached', head === '' ? EMPTY_TREE : head],
    before: head === '' ? 'none' : head,
    after: '--cached',
    stagedName: 'staged',
  });
  return uniqueChanges([
    ...trackedChanges(root, headFiles),
    ...indexChanges,
    ...untrackedChanges(root, headFiles),
  ]);
}

/**
 * Lists the gate files that a commit range changes. The range starts at the merge base of `base`
 * and `head`, so commits that `base` has and `head` does not have are not counted.
 *
 * @param {string} root - Repo root.
 * @param {string} base - The commit that the range starts after.
 * @param {string} [head] - The last commit. Default `HEAD`.
 * @returns {GateChange[]} Changes, sorted by path. It throws when git fails.
 */
export function range(root, base, head = 'HEAD') {
  let from = base;
  if (base !== EMPTY_TREE) {
    const merge = git(root, [...GIT_FLAGS, 'merge-base', base, head]);
    if (merge.status === 0 && merge.stdout.trim() !== '') {
      from = merge.stdout.trim();
    } else if (merge.status !== 1) {
      throw new Error(
        `git merge-base ${base} ${head} failed (exit ${String(merge.status)}): ${merge.stderr.trim().slice(0, 300)}`,
      );
    }
  }
  return uniqueChanges(
    diffChanges(root, {
      args: [from, head],
      before: from === EMPTY_TREE ? 'none' : from,
      after: head,
    }),
  );
}

/**
 * Finds the commit that a push or a pull request starts after: the upstream of the branch, else
 * `origin/main`, else `origin/master`, else the root commit.
 *
 * @param {string} root - Repo root.
 * @returns {{ ref: string, sha: string } | null} The base, or null when the repo has no commit.
 */
export function pushBase(root) {
  if (headSha(root) === '') {
    return null;
  }
  for (const ref of PUSH_BASE_REFS) {
    const found = git(root, [...GIT_FLAGS, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    if (found.status === 0 && found.stdout.trim() !== '') {
      return { ref, sha: found.stdout.trim() };
    }
  }
  const roots = gitOrThrow(root, [...GIT_FLAGS, 'rev-list', '--max-parents=0', 'HEAD'])
    .stdout.trim()
    .split('\n')
    .filter((line) => line !== '');
  const oldest = roots.at(-1);
  if (oldest === undefined) {
    throw new Error('git rev-list found no root commit for HEAD');
  }
  return { ref: 'the root commit', sha: oldest };
}

/**
 * Lists the gate files that a push or a pull request would publish: the range from the push base
 * to HEAD.
 *
 * @param {string} root - Repo root.
 * @returns {{ base: string, changes: GateChange[] }} The base name and the changes. It throws when git fails.
 */
export function pushRange(root) {
  const base = pushBase(root);
  return base === null
    ? { base: 'no commit', changes: [] }
    : { base: base.ref, changes: range(root, base.sha, 'HEAD') };
}

/**
 * Lists the gate files that commits made since the session base change.
 *
 * @param {string} root - Repo root.
 * @returns {GateChange[]} Changes. Empty when there is no commit.
 */
export function committedSinceSession(root) {
  return headSha(root) === '' ? [] : range(root, sessionBase(root), 'HEAD');
}

/**
 * Writes one change as text.
 *
 * @param {GateChange} entry - A change.
 * @returns {string} For example `scripts/gates/a.mjs (modified)`.
 */
export function describeChange(entry) {
  return `${entry.file} (${entry.change}${entry.detail === undefined ? '' : `: ${entry.detail}`})`;
}

/**
 * Writes the message of a Stop block: one line for each changed gate file.
 *
 * @param {GateChange[]} changes - Changes.
 * @returns {string} The text.
 */
export function uncommittedMessage(changes) {
  const lines = changes.map(
    (entry) => `- ${describeChange(entry)}: ${GATE_MESSAGE.replace('<file>', entry.file)}`,
  );
  return `${String(changes.length)} gate file change${changes.length === 1 ? '' : 's'}:\n${lines.join('\n')}`;
}

/**
 * Writes the warning for commits that changed gate files.
 *
 * @param {GateChange[]} changes - Changes made by commits.
 * @returns {string} One line, or an empty string when there is no change.
 */
export function committedWarning(changes) {
  if (changes.length === 0) {
    return '';
  }
  const files = [...new Set(changes.map((entry) => entry.file))];
  return `WARNING: commits since the session base change gate files (${files.slice(0, 8).join(', ')}${files.length > 8 ? ', ...' : ''}). Tell the user these commits change gate files.`;
}
