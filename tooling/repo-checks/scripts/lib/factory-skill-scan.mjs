// Scan of skill and agent files for R-25 (design factory-daily-run 8). Only the state script
// touches `.claude/factory/`, and only the metrics path posts comments (R-8).
import path from 'node:path';

import { listFilesRecursive, readRepositoryFile } from './fs-io.mjs';

const FORBIDDEN = [
  { rule: 'names the state folder', pattern: /\.claude\/factory/ },
  { rule: 'calls gh pr comment or gh issue comment', pattern: /gh\s+(?:pr|issue)\s+comment/ },
];

/** @returns {{ file: string, line: number, rule: string }[]} Each line of the text that breaks a rule. */
export function findForbidden(file, text) {
  return text.split('\n').flatMap((line, index) =>
    FORBIDDEN.filter(({ pattern }) => pattern.test(line)).map(({ rule }) => ({
      file,
      line: index + 1,
      rule,
    })),
  );
}

/**
 * @param {string} root - Repository root.
 * @param {string[]} folders - Folders under the root to scan, subfolders included. A missing folder throws.
 * @returns {{ file: string, line: number, rule: string }[]} Findings, with file paths relative to the root.
 */
export function scanFolders(root, folders) {
  return folders
    .flatMap((folder) => listFilesRecursive(path.join(root, folder)))
    .map((file) => path.relative(root, file))
    .flatMap((file) => findForbidden(file, readRepositoryFile(root, file)));
}
