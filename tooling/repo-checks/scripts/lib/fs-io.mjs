// File system calls with computed paths for the scripts of this package.
// Keep every computed-path fs call in this file (eslint exception in tooling/eslint-config/src/monorepo.js).
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { isatty } from 'node:tty';

/**
 * @param {string} root - Repo root.
 * @param {string} file - File path, relative to the root.
 * @returns {string} The file text.
 */
export function readRepositoryFile(root, file) {
  return readFileSync(path.join(root, file), 'utf8');
}

const RETRY_WAIT_MS = 10;

function readChunk(buffer) {
  try {
    return readSync(0, buffer);
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    if (code === 'EOF' || code === 'EBADF') return 0;
    if (code !== 'EAGAIN') throw error;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, RETRY_WAIT_MS);
    return -1;
  }
}

/**
 * @param {number} [maxBytes] - Stop after this many bytes. No limit when left out.
 * @returns {string} Stdin, or its first maxBytes bytes. '' when stdin is a terminal or closed.
 */
export function readStdin(maxBytes = Infinity) {
  if (isatty(0)) return '';
  const chunks = [];
  let total = 0;
  while (total < maxBytes) {
    const buffer = Buffer.alloc(Math.min(65_536, maxBytes - total));
    const count = readChunk(buffer);
    if (count === 0) break;
    if (count > 0) {
      chunks.push(buffer.subarray(0, count));
      total += count;
    }
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * @param {string} file - Absolute path.
 * @returns {string | undefined} The file text, or undefined when the file does not exist.
 */
export function readOptional(file) {
  return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
}

/**
 * @param {string} file - Absolute path.
 * @returns {Buffer} The file content.
 */
export function readBytes(file) {
  return readFileSync(file);
}

/**
 * @param {string} target - Absolute path.
 * @returns {boolean} True when it exists.
 */
export function exists(target) {
  return existsSync(target);
}

/**
 * @param {string} target - Path.
 * @returns {string} The real path (symbolic links resolved). The path itself when it does not exist.
 */
export function realPath(target) {
  return existsSync(target) ? realpathSync(target) : target;
}

/**
 * @param {string} folder - Absolute path.
 * @returns {string[]} Names of the entries, or [] when the folder does not exist.
 */
export function listFolder(folder) {
  return existsSync(folder) ? readdirSync(folder) : [];
}

/**
 * Appends text. Creates the folder first. One small append is atomic, so parallel hooks are safe.
 *
 * @param {string} file - Absolute path.
 * @param {string} text - Text to append.
 */
export function appendText(file, text) {
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, text);
}

/**
 * Writes a temp file, then renames it, so a reader never sees half a file.
 *
 * @param {string} file - Absolute path.
 * @param {string} text - New file text.
 */
export function writeAtomic(file, text) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${String(process.pid)}.tmp`;
  writeFileSync(temporary, text);
  renameSync(temporary, file);
}

/**
 * @param {string} file - Absolute file path, for example $GITHUB_STEP_SUMMARY.
 * @param {string} text - Text to add at the end of the file.
 */
export function appendToFile(file, text) {
  appendFileSync(file, text, 'utf8');
}

/**
 * Deletes a file. No error when it does not exist.
 *
 * @param {string} file - Absolute path.
 */
export function removeFile(file) {
  rmSync(file, { force: true });
}

/**
 * Renames a file. The rename is atomic: only one caller moves a given file.
 *
 * @param {string} from - Absolute path.
 * @param {string} to - Absolute path.
 * @returns {boolean} True when it moved the file. False when the file does not exist.
 */
export function renameIfExists(from, to) {
  try {
    renameSync(from, to);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

/**
 * Creates a file with an exclusive create (flag wx). Creates the folder first.
 *
 * @param {string} file - Absolute path.
 * @param {string} text - File text.
 * @returns {boolean} True when it created the file. False when the file already exists.
 */
export function createExclusive(file, text) {
  mkdirSync(path.dirname(file), { recursive: true });
  try {
    writeFileSync(file, text, { flag: 'wx' });
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') return false;
    throw error;
  }
}

/**
 * @param {string} folder - Absolute path.
 * @returns {string[]} Absolute paths of all files under the folder, subfolders included.
 */
export function listFilesRecursive(folder) {
  return readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
}
