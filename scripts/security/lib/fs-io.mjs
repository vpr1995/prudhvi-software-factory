// File system calls with computed paths for scripts/security/install-tools.mjs.
// Keep every computed-path fs call in this file (eslint exception in tooling/eslint-config/src/monorepo.js).
import {
  accessSync,
  chmodSync,
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * @param {string} target - Path.
 * @returns {boolean} True when it exists.
 */
export function exists(target) {
  return existsSync(target);
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
 * @param {string} prefix - Name prefix.
 * @returns {string} The new temporary folder.
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
 * @param {string} folder - Path.
 * @returns {void}
 */
export function makeDirectory(folder) {
  mkdirSync(folder, { recursive: true });
}

/**
 * @param {string} file - Path. The parent folder must exist.
 * @param {Uint8Array} bytes - Content.
 * @returns {void}
 */
export function writeBytes(file, bytes) {
  writeFileSync(file, bytes);
}

/**
 * @param {string} file - Path.
 * @returns {void}
 */
export function makeExecutable(file) {
  chmodSync(file, 0o755);
}

/**
 * @param {string} file - Path.
 * @returns {boolean} True for a file (after links) that the process can run.
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
 * Moves a file into place. Across devices: copy next to the destination, chmod 755, rename,
 * remove the source.
 *
 * @param {string} source - File to move.
 * @param {string} destination - New path.
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
