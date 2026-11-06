// File system calls with computed paths for the scripts of this package.
// Keep every computed-path fs call in this file (eslint exception in tooling/eslint-config/src/monorepo.js).
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

/**
 * @param {string} root - Repo root.
 * @param {string} file - File path, relative to the root.
 * @returns {string} The file text.
 */
export function readRepositoryFile(root, file) {
  return readFileSync(path.join(root, file), 'utf8');
}

/** @returns {string} All of stdin. */
export function readStdin() {
  return readFileSync(0, 'utf8');
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
