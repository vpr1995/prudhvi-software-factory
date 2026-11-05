// File system calls with computed paths for the scaffolder.
// Keep every computed-path fs call in this file (eslint exception in tooling/eslint-config/src/monorepo.js).
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * @param {string} root - Base folder.
 * @param {string} file - File path, relative to the root.
 * @returns {Promise<string>} The file text.
 */
export async function readText(root, file) {
  return readFile(path.join(root, file), 'utf8');
}

/**
 * Write a new file and make its parent folders. Fail when the file exists.
 *
 * @param {string} root - Base folder.
 * @param {string} file - File path, relative to the root.
 * @param {string} text - File text.
 * @returns {Promise<void>}
 */
export async function writeNewText(root, file, text) {
  const target = path.join(root, file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, text, { encoding: 'utf8', flag: 'wx' });
}

/**
 * Write over a file that exists.
 *
 * @param {string} root - Base folder.
 * @param {string} file - File path, relative to the root.
 * @param {string} text - File text.
 * @returns {Promise<void>}
 */
export async function replaceText(root, file, text) {
  await writeFile(path.join(root, file), text, 'utf8');
}

/**
 * @param {string} root - Base folder.
 * @param {string} file - Path, relative to the root.
 * @returns {Promise<boolean>} True when the path exists.
 */
export async function pathExists(root, file) {
  try {
    await access(path.join(root, file));
    return true;
  } catch {
    return false;
  }
}

/**
 * List every file under a folder, sorted.
 *
 * @param {string} folder - Absolute folder path.
 * @returns {Promise<string[]>} File paths relative to the folder, with "/" separators.
 */
export async function listFiles(folder) {
  const entries = await readdir(folder, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(folder, path.join(entry.parentPath, entry.name)))
    .map((file) => file.split(path.sep).join('/'))
    .sort();
}

/**
 * @returns {Promise<string>} A new empty folder in the OS temp folder.
 */
export async function makeTemporaryFolder() {
  return mkdtemp(path.join(tmpdir(), 'tooling-templates-'));
}

/**
 * @param {string} folder - Absolute folder path to remove with its contents.
 * @returns {Promise<void>}
 */
export async function removeFolder(folder) {
  await rm(folder, { recursive: true, force: true });
}
