// Review router of the factory (design factory-daily-run 4.2, R-18 to R-22, R-34).
// Pure functions: no git, no gh, no file system.
import path from 'node:path';

import { routing } from './factory-routing.mjs';
import { isTestFile } from './test-guard-rules.mjs';

const DOT_NAME = '_dot_';
const TIER_RANK = { low: 0, medium: 1, high: 2 };
const SIZE_LINE = /^Size:[ \t]*(\d+)(?![\d.])/m;
const NO_RULE = 'no rule decides (R-19)';

// path.matchesGlob does not match a name that starts with a dot through * or **. Replace the
// leading dot of each segment, in the path and in the glob the same way.
function hideDots(text) {
  return text
    .split('/')
    .map((segment) => (segment.startsWith('.') ? `${DOT_NAME}${segment.slice(1)}` : segment))
    .join('/');
}

/**
 * @param {string} file - Repo path with / separators.
 * @param {string} glob - Glob of the routing table.
 * @returns {boolean} True when the path matches the glob. Dot names match too.
 */
export function matches(file, glob) {
  return path.posix.matchesGlob(hideDots(file), hideDots(glob));
}

const matchesAny = (file, globs) => globs.some((glob) => matches(file, glob));

/** @returns {boolean} True when the path is a doc-only path of the table. */
function isDocumentOnly(file, table) {
  return matchesAny(file, table.docOnly) && !matchesAny(file, table.docOnlyExclude);
}

/**
 * @param {string} file - Repo path.
 * @param {object} [table] - Routing table.
 * @returns {'low' | 'medium' | 'high'} The tier of one path.
 */
export function tierOf(file, table = routing) {
  if (matchesAny(file, table.tiers.high)) return 'high';
  if (matchesAny(file, table.tiers.medium)) return 'medium';
  return isDocumentOnly(file, table) || isTestFile(file) ? 'low' : 'medium';
}

/**
 * @param {string} body - Ticket body.
 * @returns {number | undefined} The number of the `Size: <n>` line, or undefined when it is missing.
 */
export function parseSize(body) {
  const match = SIZE_LINE.exec(body);
  return match === null ? undefined : Number(match[1]);
}

/** @returns {{ budget: number, warnings: string[] }} The line budget for the ticket size (R-34). */
function budgetFor(size, table) {
  const budgets = new Map(Object.entries(table.diffBudget));
  const known = Number.isInteger(size) ? budgets.get(String(size)) : undefined;
  if (known !== undefined) return { budget: known, warnings: [] };
  const missing = budgets.get('missing');
  const reason = size === undefined ? 'size missing' : `size ${String(size)} not from 1 to 5`;
  return { budget: missing, warnings: [`${reason}: budget ${String(missing)}`] };
}

/** @returns {{ rule: string } | { reason: string }} Run the pass with a rule, or skip it with a reason. */
function decide(when, context) {
  if (when === 'always') return { rule: 'always' };
  if (context.docOnly) return { reason: 'doc-only diff' };
  if (when === 'code-change') return { rule: 'code-change' };
  if (Array.isArray(when) && when.length > 0) {
    const glob = when.find((entry) => context.paths.some((file) => matches(file, entry)));
    return glob === undefined ? { reason: 'no path matched' } : { rule: glob };
  }
  return { rule: NO_RULE };
}

function modelFor(model, tier, table) {
  if (model === 'tier') return tier === 'high' ? table.models.high : table.models.default;
  return model ?? table.models.default;
}

/**
 * Route one diff to the review passes.
 *
 * @param {object} input - Router input.
 * @param {string} input.base - Diff base, for example origin/main.
 * @param {{ path: string, oldPath?: string, added: number, deleted: number }[]} input.changedFiles - Changed files and line counts.
 * @param {number} [input.size] - Ticket size. Missing gives the `missing` budget and a warning.
 * @param {boolean} [input.checkConfig] - True when the local test guard reports "check config changed".
 * @param {object} [input.table] - Routing table.
 * @returns {object} The router JSON of design 4.2.
 */
export function route({ base, changedFiles, size, checkConfig = false, table = routing }) {
  const paths = [
    ...new Set(changedFiles.flatMap((entry) => [entry.path, entry.oldPath ?? entry.path])),
  ];
  const documentOnly = paths.every((file) => isDocumentOnly(file, table));
  let tier = checkConfig ? 'high' : 'low';
  for (const file of paths) {
    const fileTier = tierOf(file, table);
    if (TIER_RANK[fileTier] > TIER_RANK[tier]) tier = fileTier;
  }
  const passes = [];
  const skipped = [];
  for (const [name, pass] of Object.entries(table.passes)) {
    const decision = decide(pass.when, { docOnly: documentOnly, paths });
    if ('reason' in decision) skipped.push({ name, reason: decision.reason });
    else passes.push({ name, model: modelFor(pass.model, tier, table), rule: decision.rule });
  }
  const changedLines = changedFiles
    .filter((entry) => !isTestFile(entry.path) && !matchesAny(entry.path, table.excludeFromCount))
    .reduce((sum, entry) => sum + entry.added + entry.deleted, 0);
  const { budget, warnings } = budgetFor(size, table);
  if (changedFiles.length === 0) warnings.push('no changed files');
  return {
    base,
    tier,
    docOnly: documentOnly,
    passes,
    skipped,
    changedLines,
    budget,
    overBudget: changedLines > budget,
    warnings,
  };
}
