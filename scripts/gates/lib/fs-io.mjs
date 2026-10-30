// All file reads and writes with a path that is not a literal live in this one module.
// `security/detect-non-literal-fs-filename` is off for this one file (tooling/eslint-config/src/monorepo.js).
import {
  accessSync,
  chmodSync,
  constants,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Reads all of stdin.
 *
 * @returns {string} The text, or an empty string when stdin is closed.
 */
export function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Reads a text file.
 *
 * @param {string} file - Absolute or relative path.
 * @returns {string | null} The text, or null when the file does not exist or is not readable.
 */
export function readText(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Reads a JSON file.
 *
 * @param {string} file - Path.
 * @returns {unknown} The parsed value, or null when missing or invalid.
 */
export function readJson(file) {
  const text = readText(file);
  if (text === null) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Writes a text file and creates the parent folders.
 *
 * @param {string} file - Path.
 * @param {string} text - Content.
 * @returns {void}
 */
export function writeText(file, text) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

/**
 * Copies a folder and everything in it, and creates the parent folders of the target. A symbolic
 * link is copied as a link with its text as it is: the copy does not follow it.
 *
 * @param {string} source - Folder to copy.
 * @param {string} target - New folder path.
 * @returns {void} It throws when the copy fails.
 */
export function copyTree(source, target) {
  mkdirSync(path.dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true, verbatimSymlinks: true, errorOnExist: false });
}

/**
 * Reports what a path is.
 *
 * @param {string} target - Path.
 * @returns {'file' | 'dir' | 'none'} The kind.
 */
export function pathKind(target) {
  try {
    const info = statSync(target);
    return info.isDirectory() ? 'dir' : 'file';
  } catch {
    return 'none';
  }
}

/**
 * Tells whether a path exists.
 *
 * @param {string} target - Path.
 * @returns {boolean} True when it exists.
 */
export function exists(target) {
  return existsSync(target);
}

/**
 * Gets the size of a file.
 *
 * @param {string} file - Path.
 * @returns {number} Size in bytes, or -1 when the file is missing.
 */
export function fileSize(file) {
  try {
    return statSync(file).size;
  } catch {
    return -1;
  }
}

/**
 * Lists a folder.
 *
 * @param {string} folder - Path.
 * @returns {{ name: string, isDirectory: boolean }[]} Entries, sorted by name. Empty when missing.
 */
export function listDirectory(folder) {
  try {
    return readdirSync(folder, { withFileTypes: true })
      .map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }))
      .sort((left, right) => left.name.localeCompare(right.name));
  } catch {
    return [];
  }
}

/**
 * Resolves symbolic links. A path that does not exist yet keeps its real parent.
 *
 * @param {string} target - Path.
 * @returns {string} The real path.
 */
export function realPath(target) {
  try {
    return realpathSync(target);
  } catch {
    const parent = path.dirname(target);
    if (parent === target) {
      return target;
    }
    return path.join(realPath(parent), path.basename(target));
  }
}

/**
 * Makes a temporary folder.
 *
 * @param {string} prefix - Name prefix.
 * @returns {string} The folder path.
 */
export function makeTemporaryDirectory(prefix) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * Removes a file or folder. Missing paths are fine.
 *
 * @param {string} target - Path.
 * @returns {void}
 */
export function removePath(target) {
  rmSync(target, { recursive: true, force: true });
}

/**
 * Reads a file as bytes. The path is read as is: no filter, no line-ending change.
 *
 * @param {string} file - Path.
 * @returns {Buffer | null} The bytes, or null when the file is missing or not readable.
 */
export function readBytes(file) {
  try {
    return readFileSync(file);
  } catch {
    return null;
  }
}

/**
 * Describes a path without following a symbolic link.
 *
 * @param {string} target - Path.
 * @returns {{ kind: 'file' | 'symlink' | 'dir' | 'other', executable: boolean } | null} The kind, or null when nothing exists there.
 */
export function inspectPath(target) {
  try {
    const info = lstatSync(target);
    let kind = 'other';
    if (info.isSymbolicLink()) {
      kind = 'symlink';
    } else if (info.isFile()) {
      kind = 'file';
    } else if (info.isDirectory()) {
      kind = 'dir';
    }
    return {
      kind: /** @type {'file' | 'symlink' | 'dir' | 'other'} */ (kind),
      executable: (info.mode & 0o111) !== 0,
    };
  } catch {
    return null;
  }
}

/**
 * Reads the target of a symbolic link.
 *
 * @param {string} link - Path of the link.
 * @returns {string | null} The link text, or null when the path is not a link.
 */
export function readLinkText(link) {
  try {
    return readlinkSync(link);
  } catch {
    return null;
  }
}

/**
 * Makes a folder and the missing parent folders. An existing folder is fine.
 *
 * @param {string} folder - Path.
 * @returns {void}
 */
export function makeDirectory(folder) {
  mkdirSync(folder, { recursive: true });
}

/**
 * Writes bytes to a file. The caller makes sure the parent folder exists.
 *
 * @param {string} file - Path.
 * @param {Uint8Array} bytes - Content.
 * @returns {void}
 */
export function writeBytes(file, bytes) {
  writeFileSync(file, bytes);
}

/**
 * Sets the mode of a file to 0o755: the owner can write, everyone can read and run.
 *
 * @param {string} file - Path.
 * @returns {void}
 */
export function makeExecutable(file) {
  chmodSync(file, 0o755);
}

/**
 * Tells whether a path is a file, after links are followed, that the process can run.
 *
 * @param {string} file - Path.
 * @returns {boolean} True for a runnable file, false for anything else.
 */
export function isExecutableFile(file) {
  try {
    if (!statSync(file).isFile()) {
      return false;
    }
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Moves a file into place. A rename is atomic. When the two paths are on different devices, it
 * copies the file next to the destination, makes it executable, renames the copy, and removes the
 * source. Any other error is thrown.
 *
 * @param {string} source - File to move.
 * @param {string} destination - New path of the file.
 * @returns {void}
 */
export function movePath(source, destination) {
  try {
    renameSync(source, destination);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'EXDEV') {
      throw error;
    }
    const staged = `${destination}.tmp-${String(process.pid)}`;
    copyFileSync(source, staged);
    chmodSync(staged, 0o755);
    renameSync(staged, destination);
    rmSync(source, { force: true });
  }
}

/**
 * Lists every file and symbolic link under a folder. It does not follow links to folders, and it
 * does not read a folder whose name is in `skipNames` or whose path from the root is in `skipPaths`.
 * It does not use git, so a file that git ignores is listed too.
 *
 * @param {string} root - Folder to walk.
 * @param {{ skipNames: ReadonlySet<string>, skipPaths: ReadonlySet<string> }} options - Folders to leave out.
 * @returns {{ path: string, kind: 'file' | 'symlink' | 'other' | 'symlink-dir' }[]} Entries with paths from `root`, forward slashes, sorted.
 */
export function walkFiles(root, options) {
  const found = [];
  const pending = [''];
  while (pending.length > 0) {
    const relative = pending.pop() ?? '';
    for (const entry of listFolder(root, relative)) {
      const child = relative === '' ? entry.name : `${relative}/${entry.name}`;
      if (!entry.isDirectory()) {
        found.push(walkEntry(root, child, entry));
      } else if (!options.skipNames.has(entry.name) && !options.skipPaths.has(child)) {
        pending.push(child);
      }
    }
  }
  return found.sort((left, right) => (left.path < right.path ? -1 : 1));
}

/**
 * Reads the entries of one folder.
 *
 * @param {string} root - Folder to walk.
 * @param {string} relative - Folder path from `root`.
 * @returns {import('node:fs').Dirent[]} The entries, or an empty list when the folder cannot be read.
 */
function listFolder(root, relative) {
  try {
    return readdirSync(path.join(root, relative), { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * Describes one file or link that a walk found.
 *
 * @param {string} root - Folder to walk.
 * @param {string} child - Path from `root`.
 * @param {import('node:fs').Dirent} entry - The entry.
 * @returns {{ path: string, kind: 'file' | 'symlink' | 'other' | 'symlink-dir' }} The entry.
 */
function walkEntry(root, child, entry) {
  if (entry.isSymbolicLink()) {
    const target = statSyncKind(path.join(root, child));
    return { path: child, kind: target === 'dir' ? 'symlink-dir' : 'symlink' };
  }
  return { path: child, kind: entry.isFile() ? 'file' : 'other' };
}

/**
 * Tells what a symbolic link points to.
 *
 * @param {string} target - Path of the link.
 * @returns {'dir' | 'other'} `dir` when the link leads to a folder.
 */
function statSyncKind(target) {
  return pathKind(target) === 'dir' ? 'dir' : 'other';
}
