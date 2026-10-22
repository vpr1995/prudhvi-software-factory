/** @typedef {import('./diff-parse.mjs').DiffFile} DiffFile */
/** @typedef {{ file: string, line: number, rule: string, message: string }} Finding */

const THRESHOLD =
  /(--cov-fail-under|cov[_-]fail[_-]under|fail[_-]under|coverageThreshold|min(?:imum)?[_-]?coverage|coverage[_-]?min(?:imum)?|lines|branches|functions|statements)["']?\s*[:=]?\s*["']?(\d+)/gi;
const GENERIC_KEYS = new Set(['lines', 'branches', 'functions', 'statements']);
const GENERIC_KEY_FILES = /vitest|jest|vite\.config|threshold|coverage/i;
const COVERAGE_FILES =
  /(?:^|\/)(?:vitest|vite|jest)[^/]*\.[cm]?[jt]s$|(?:^|\/)vitest[^/]*\/|pyproject\.toml$|\.coveragerc$|setup\.cfg$|tox\.ini$|package\.json$|Makefile$|\.sh$|\.ya?ml$|coverage|thresholds?/i;

/**
 * Reads threshold numbers from lines.
 *
 * @param {import('./diff-parse.mjs').DiffLine[]} lines - Added or removed lines.
 * @param {boolean} allowGeneric - True when keys like `lines` count.
 * @returns {Map<string, { value: number, line: number }[]>} Values by normalized key.
 */
function readThresholds(lines, allowGeneric) {
  const found = new Map();
  for (const entry of lines) {
    for (const match of entry.text.matchAll(THRESHOLD)) {
      const key = (match[1] ?? '').toLowerCase().replaceAll(/[_-]/g, '');
      if (GENERIC_KEYS.has(key) && !allowGeneric) {
        continue;
      }
      const list = found.get(key) ?? [];
      list.push({
        value: Number(match[2]),
        line: entry.kind === '+' ? entry.newLine : entry.oldLine,
      });
      found.set(key, list);
    }
  }
  return found;
}

/**
 * Finds coverage thresholds that go down or disappear.
 *
 * @param {DiffFile} file - A changed file.
 * @returns {Finding[]} Findings.
 */
export function coverageFindings(file) {
  if (!COVERAGE_FILES.test(file.path) || file.status === 'deleted') {
    return [];
  }
  const allowGeneric = GENERIC_KEY_FILES.test(file.path);
  const removed = readThresholds(
    file.lines.filter((line) => line.kind === '-'),
    allowGeneric,
  );
  const added = readThresholds(
    file.lines.filter((line) => line.kind === '+'),
    allowGeneric,
  );
  const findings = [];
  for (const [key, oldEntries] of removed) {
    const newEntries = added.get(key);
    const oldMax = Math.max(...oldEntries.map((entry) => entry.value));
    if (newEntries === undefined) {
      if (allowGeneric || !GENERIC_KEYS.has(key)) {
        findings.push({
          file: file.path,
          line: oldEntries[0]?.line ?? 1,
          rule: 'coverage-lowered',
          message: `removes the coverage threshold "${key}" (was ${String(oldMax)})`,
        });
      }
      continue;
    }
    const lowest = newEntries.reduce((low, entry) => (entry.value < low.value ? entry : low));
    if (lowest.value < oldMax) {
      findings.push({
        file: file.path,
        line: lowest.line,
        rule: 'coverage-lowered',
        message: `lowers the coverage threshold "${key}" from ${String(oldMax)} to ${String(lowest.value)}`,
      });
    }
  }
  return findings;
}
