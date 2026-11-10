// The only module of the scripts that reads or writes files with a computed path. ESLint turns off
// `security/detect-non-literal-fs-filename` for this file only (eslint.config.js). The paths come
// from the project folder that the CLI passes, not from a user.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Lists the files of a folder and its subfolders.
 *
 * @param folder - The folder.
 * @returns The file paths.
 */
export function listFiles(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? listFiles(join(folder, entry.name)) : [join(folder, entry.name)],
  );
}

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
