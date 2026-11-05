// File system calls with computed paths for scripts/lint-on-edit.mjs.
// Keep every computed-path fs call in this file (eslint exception in src/monorepo.js).
import { existsSync, readFileSync } from 'node:fs';

/**
 * @param {string} file - Path.
 * @returns {string} The file text.
 */
export function readText(file) {
  return readFileSync(file, 'utf8');
}

/**
 * @param {string} target - Path.
 * @returns {boolean} True when it exists.
 */
export function exists(target) {
  return existsSync(target);
}
