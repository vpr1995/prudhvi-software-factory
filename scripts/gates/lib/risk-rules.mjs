// Risk tier path rules (docs/standards/risk-tiers.md, section 2). They give the floor of the tier of
// a PR. The Claude classifier can only raise the tier, never lower it.
//
// Each changed path gets a tier and a reason. The tier of the PR is the highest tier of its paths.
//   high    gate files, `platform/**`, `packages/**`, `**/cdk.json`, `.github/**`, a lockfile,
//           `go.mod`, a dependency field of a package.json, a `_phase:*` script of a package.json.
//   medium  the CDK app of one project: `projects/*/bin/**`, `projects/*/lib/**` (and the old
//           `projects/*/infra/**`). The infra reviewer, cdk-nag and the synth gate check them.
//           Also the human-reviewed documents of docs/standards/gates.md, section 2.2, and all
//           other paths.
//   low     Markdown and `docs/**` (outside gate files and section 2.2), test files, Bruno files.
//   The doc names no path for authentication or billing code, so the path rules cannot see it. The
//   classifier has to find it.
import { isTestFile } from './anti-skip-rules.mjs';
import { phaseDifferences } from './gate-integrity.mjs';
import { findGate, isInProtectedFolder } from './gate-list.mjs';
import { matchesGlob } from './glob.mjs';

/** The tiers, lowest first. */
export const TIERS = Object.freeze(['low', 'medium', 'high']);

/**
 * @typedef {'low' | 'medium' | 'high'} Tier
 * @typedef {object} FileRisk
 * @property {string} file - Path from the repo root.
 * @property {Tier} tier - The tier of this path.
 * @property {string} rule - Id of the rule that decided.
 * @property {string} reason - Why, in one line.
 */

/**
 * @typedef {object} DiffAccess
 * @property {(file: string) => string | null} readBase - Reads a file as it was before the change (null when it did not exist).
 * @property {(file: string) => string | null} readHead - Reads a file as it is after the change (null when it does not exist).
 */

/** Path rules for high tier. The first match decides. */
const HIGH_PATH_RULES = Object.freeze([
  {
    rule: 'platform',
    globs: ['platform/**'],
    reason: 'platform/** holds the shared AWS resources',
  },
  {
    rule: 'packages',
    globs: ['packages/**'],
    reason: 'packages/** is shared code with a wide effect',
  },
  { rule: 'cdk-json', globs: ['**/cdk.json'], reason: 'CDK app settings' },
  { rule: 'github', globs: ['.github/**'], reason: '.github/** holds the CI and release controls' },
  {
    rule: 'lockfile',
    globs: ['**/pnpm-lock.yaml', '**/package-lock.json', '**/yarn.lock', '**/uv.lock', '**/go.sum'],
    reason: 'a lockfile changes (dependencies)',
  },
  { rule: 'go-mod', globs: ['**/go.mod'], reason: 'go.mod changes (dependencies)' },
  {
    rule: 'pyproject',
    globs: ['**/pyproject.toml', '**/requirements*.txt'],
    reason: 'Python dependencies and tool settings',
  },
]);

/** Path rules for medium tier, checked after the high rules. The first match decides. */
const MEDIUM_PATH_RULES = Object.freeze([
  {
    rule: 'project-cdk',
    globs: ['projects/*/bin/**', 'projects/*/lib/**', 'projects/*/infra/**'],
    reason: 'the CDK app of a project: cloud resources and IAM',
  },
]);

/** Documents that a human reviews (gates.md, section 2.2). They are at least medium. */
const REVIEWED_DOCUMENT_GLOBS = Object.freeze([
  'CLAUDE.md',
  'AGENTS.md',
  'docs/guides/**',
  'docs/templates/**',
  'docs/standards/**',
]);

const DOCUMENT_GLOBS = Object.freeze(['**/*.md', '**/*.mdx', 'docs/**']);
const BRUNO_GLOBS = Object.freeze(['projects/*/bruno/**']);

/** The fields of a package.json that decide which packages get installed. */
const DEPENDENCY_FIELDS = Object.freeze([
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
  'bundledDependencies',
  'bundleDependencies',
  'overrides',
  'resolutions',
  'pnpm',
]);

/**
 * Tells whether a path matches one of the globs.
 *
 * @param {string} file - Path from the repo root.
 * @param {readonly string[]} globs - Globs.
 * @returns {boolean} True when one matches.
 */
function matchesAny(file, globs) {
  return globs.some((glob) => matchesGlob(file, glob));
}

/**
 * Parses a package.json text.
 *
 * @param {string | null} text - The text (null when the file does not exist).
 * @returns {Record<string, unknown> | null | 'unreadable'} The object, an empty object for a missing file, or `unreadable`.
 */
function parsePackage(text) {
  if (text === null) {
    return {};
  }
  try {
    const parsed = JSON.parse(text);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : 'unreadable';
  } catch {
    return 'unreadable';
  }
}

/**
 * Finds the dependency fields that differ between two package.json texts.
 *
 * @param {string | null} before - Old text.
 * @param {string | null} after - New text.
 * @returns {string[] | 'unreadable'} The names of the fields that differ (empty when no dependency changes).
 */
export function dependencyFieldChanges(before, after) {
  const oldPackage = parsePackage(before);
  const newPackage = parsePackage(after);
  if (
    oldPackage === 'unreadable' ||
    newPackage === 'unreadable' ||
    oldPackage === null ||
    newPackage === null
  ) {
    return 'unreadable';
  }
  return DEPENDENCY_FIELDS.filter(
    (field) => JSON.stringify(oldPackage[field]) !== JSON.stringify(newPackage[field]),
  );
}

/**
 * Judges a package.json change.
 *
 * @param {string} file - Path of a package.json.
 * @param {DiffAccess | undefined} diff - Both sides of the change, when known.
 * @returns {{ rule: string, reason: string } | null} A high-tier verdict, or null when the change touches no dependency field and no `_phase:*` script.
 */
function packageVerdict(file, diff) {
  if (diff === undefined) {
    return {
      rule: 'package-json',
      reason: 'package.json changed, and without the diff the dependency fields cannot be checked',
    };
  }
  const before = diff.readBase(file);
  const after = diff.readHead(file);
  const fields = dependencyFieldChanges(before, after);
  if (fields === 'unreadable') {
    return {
      rule: 'package-json',
      reason: 'package.json cannot be read as JSON, so it may change dependencies',
    };
  }
  if (fields.length > 0) {
    return {
      rule: 'dependencies',
      reason: `dependency change in package.json (${fields.join(', ')})`,
    };
  }
  const phases = phaseDifferences(before, after);
  if (phases.length > 0) {
    return { rule: 'gate-phase-script', reason: `gate: ${phases.join(', ')}` };
  }
  return null;
}

/**
 * Finds the tier of one path.
 *
 * @param {string} file - Path from the repo root.
 * @param {DiffAccess | undefined} diff - Both sides of the change, when known.
 * @returns {FileRisk} The tier and the reason.
 */
export function classifyPath(file, diff) {
  const gate = findGate(file);
  if (gate !== null) {
    return { file, tier: 'high', rule: 'gate-file', reason: `gate file (${gate.glob})` };
  }
  if (isInProtectedFolder(file)) {
    return { file, tier: 'high', rule: 'gate-file', reason: 'gate file (write-protected folder)' };
  }
  const high = HIGH_PATH_RULES.find((entry) => matchesAny(file, entry.globs));
  if (high !== undefined) {
    return { file, tier: 'high', rule: high.rule, reason: high.reason };
  }
  if (file === 'package.json' || file.endsWith('/package.json')) {
    const verdict = packageVerdict(file, diff);
    if (verdict !== null) {
      return { file, tier: 'high', ...verdict };
    }
  }
  const medium = MEDIUM_PATH_RULES.find((entry) => matchesAny(file, entry.globs));
  if (medium !== undefined) {
    return { file, tier: 'medium', rule: medium.rule, reason: medium.reason };
  }
  if (matchesAny(file, REVIEWED_DOCUMENT_GLOBS)) {
    return {
      file,
      tier: 'medium',
      rule: 'reviewed-document',
      reason: 'a document that a human reviews (gates.md, section 2.2)',
    };
  }
  if (matchesAny(file, DOCUMENT_GLOBS)) {
    return { file, tier: 'low', rule: 'docs', reason: 'documentation only' };
  }
  if (isTestFile(file)) {
    return { file, tier: 'low', rule: 'tests', reason: 'test file' };
  }
  if (matchesAny(file, BRUNO_GLOBS)) {
    return { file, tier: 'low', rule: 'bruno', reason: 'Bruno API collection' };
  }
  return { file, tier: 'medium', rule: 'default', reason: 'code or config with no high-tier path' };
}

/**
 * Returns the higher of two tiers.
 *
 * @param {Tier} left - A tier.
 * @param {Tier} right - A tier.
 * @returns {Tier} The higher tier.
 */
export function higherTier(left, right) {
  return TIERS.indexOf(left) >= TIERS.indexOf(right) ? left : right;
}

/**
 * Classifies a change with the path rules. This is the floor of the tier: a later step (the Claude
 * classifier) can raise the tier with `higherTier`, and must not lower it.
 *
 * @param {readonly string[]} paths - Changed paths from the repo root, forward slashes. A deleted or renamed file lists its old and new path.
 * @param {{ diff?: DiffAccess }} [options] - `diff`: read both sides of the change, so a package.json is judged by its fields. Without it, any package.json change is high.
 * @returns {{ tier: Tier, files: FileRisk[] }} The tier of the PR (`low` for no path) and the tier of each path, highest first.
 */
export function classifyPaths(paths, options = {}) {
  const files = [...new Set(paths)]
    .sort()
    .map((file) => classifyPath(file, options.diff))
    .sort((left, right) => TIERS.indexOf(right.tier) - TIERS.indexOf(left.tier));
  return { tier: files.reduce((tier, entry) => higherTier(tier, entry.tier), 'low'), files };
}
