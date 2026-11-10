// The only module of the feed script that reads or writes files with computed paths. ESLint turns
// off `security/detect-non-literal-fs-filename` for this file only (eslint.config.js). The paths come
// from the project folder that the CLI passes, not from a user.
import { readFileSync, writeFileSync } from 'node:fs';

/**
 * Reads a text file.
 *
 * @param file - The path.
 * @returns The text.
 * @throws Error with a `code` of `ENOENT` when the file does not exist.
 */
export function readText(file: string): string {
  return readFileSync(file, 'utf8');
}

/**
 * Writes a text file.
 *
 * @param file - The path.
 * @param text - The text.
 */
export function writeText(file: string, text: string): void {
  writeFileSync(file, text);
}
