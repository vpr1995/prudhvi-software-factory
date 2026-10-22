import path from 'node:path';

const SLASH = '/';

/**
 * Normalizes a repo path: forward slashes, no leading `./`, lower case for matching.
 *
 * @param {string} value - Path.
 * @returns {string} Normalized path.
 */
export function normalizeForMatch(value) {
  return path.posix.normalize(value.replaceAll('\\', SLASH)).replace(/^\.\//, '').toLowerCase();
}

/**
 * Splits a gate pattern into a matcher kind.
 * A pattern with no slash, or `**` + `/` + a name, matches the name at any depth.
 *
 * @param {string} pattern - Glob.
 * @returns {{ anyDepth: boolean, glob: string }} Parsed pattern.
 */
function parsePattern(pattern) {
  const lower = pattern.toLowerCase();
  const bare = lower.startsWith('**/') ? lower.slice('**/'.length) : lower;
  const isName = !bare.includes(SLASH);
  return { anyDepth: isName, glob: isName ? bare : lower };
}

/**
 * Tests one repo-relative path against one glob.
 *
 * @param {string} relativePath - Path from the repo root.
 * @param {string} pattern - Glob.
 * @returns {boolean} True when it matches.
 */
export function matchesGlob(relativePath, pattern) {
  const normalized = normalizeForMatch(relativePath);
  const parsed = parsePattern(pattern);
  if (parsed.anyDepth) {
    return path.posix.matchesGlob(path.posix.basename(normalized), parsed.glob);
  }
  return path.posix.matchesGlob(normalized, parsed.glob);
}

/**
 * Finds the first pattern that matches.
 *
 * @param {string} relativePath - Path from the repo root.
 * @param {readonly string[]} patterns - Globs.
 * @returns {string | null} The matching pattern, or null.
 */
export function firstMatch(relativePath, patterns) {
  return patterns.find((pattern) => matchesGlob(relativePath, pattern)) ?? null;
}
