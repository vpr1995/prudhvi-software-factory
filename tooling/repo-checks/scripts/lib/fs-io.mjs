// File system calls with computed paths for the scripts of this package.
// Keep every computed-path fs call in this file (eslint exception in tooling/eslint-config/src/monorepo.js).
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * @param {string} root - Repo root.
 * @param {string} file - File path, relative to the root.
 * @returns {string} The file text.
 */
export function readRepositoryFile(root, file) {
  return readFileSync(path.join(root, file), 'utf8');
}
