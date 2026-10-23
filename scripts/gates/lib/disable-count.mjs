// Disable count: counts the markers that switch a check off (lint, type, security and cdk-nag
// markers) that a PR adds, minus the markers it removes. A net increase fails unless the PR
// has the label `lint-exception`.
//
// The marker patterns come from the anti-skip rule list (`LINE_RULES`), so the two never drift.
// `MARKER_RULE_IDS` picks the rules. A test checks that every id exists.
import { maskStrings } from './anti-skip-mask.mjs';
import { LINE_RULES, languageOf } from './anti-skip-rules.mjs';
import { firstMatch } from './glob.mjs';

/** The label that allows a net increase of markers. */
export const LINT_EXCEPTION_LABEL = 'lint-exception';

/** Anti-skip rules whose matches are markers that switch a check off. */
export const MARKER_RULE_IDS = Object.freeze([
  'eslint-disable',
  'ts-directive',
  'coverage-ignore',
  'security-suppress',
  'py-noqa',
  'py-type-ignore',
  'py-pragma-no-cover',
  'py-pylint-disable',
  'go-nolint',
]);

/**
 * The marker that anti-skip does not have: a cdk-nag finding that code acknowledges (cdk-nag 3,
 * `Validations.of(x).acknowledge({...})`, also written as a chain that starts a line with
 * `.acknowledge(`) or suppresses (cdk-nag 2, `NagSuppressions.add...`).
 *
 * @type {import('./anti-skip-rules.mjs').LineRule}
 */
const ACKNOWLEDGE_RULE = {
  id: 'cdk-nag-acknowledge',
  languages: ['js'],
  maskStrings: true,
  pattern:
    /\bValidations\b.*\.\s*acknowledge\s*\(|^\s*\.\s*acknowledge\s*\(|\bNagSuppressions\s*\.\s*add/,
  message: 'acknowledges or suppresses a cdk-nag finding',
};

/**
 * Finds the rules that count as markers.
 *
 * @returns {import('./anti-skip-rules.mjs').LineRule[]} The anti-skip rules and the acknowledge rule. It throws when an id is not an anti-skip rule.
 */
export function markerRules() {
  const rules = MARKER_RULE_IDS.flatMap((id) => {
    const found = LINE_RULES.filter((rule) => rule.id === id);
    if (found.length === 0) {
      throw new Error(`disable-count: anti-skip has no rule "${id}"`);
    }
    return found;
  });
  return [...rules, ACKNOWLEDGE_RULE];
}

/**
 * @typedef {object} Marker
 * @property {string} file - Path from the repo root.
 * @property {number} line - Line number (new file for an added marker, old file for a removed one).
 * @property {string} rule - Id of the rule that matched.
 */

/**
 * Finds the rule that makes a line a marker.
 *
 * @param {string} file - Path from the repo root.
 * @param {string} text - The line.
 * @param {import('./anti-skip-rules.mjs').LineRule[]} rules - From `markerRules()`.
 * @returns {string | null} The id of the first rule that matches, or null. A line counts once.
 */
export function markerOf(file, text, rules) {
  const language = languageOf(file);
  for (const rule of rules) {
    if (
      rule.languages.includes(language) &&
      (rule.files === undefined || rule.files.test(file)) &&
      rule.pattern.test(rule.maskStrings === true ? maskStrings(text, { language }) : text)
    ) {
      return rule.id;
    }
  }
  return null;
}

/**
 * Lists the markers that a diff adds and removes. A path that anti-skip skips (docs, gate
 * scripts) does not count. A pure rename has no changed line, so it adds and removes nothing.
 *
 * @param {import('./diff-parse.mjs').DiffFile[]} files - Changed files with their lines.
 * @param {readonly string[]} ignorePaths - Paths to skip (`antiSkip.ignorePaths` of gate-files.json).
 * @returns {{ added: Marker[], removed: Marker[] }} The markers.
 */
export function collectMarkers(files, ignorePaths) {
  const rules = markerRules();
  const added = [];
  const removed = [];
  for (const file of files) {
    if (firstMatch(file.path, ignorePaths) !== null) {
      continue;
    }
    for (const line of file.lines) {
      const rule = markerOf(file.path, line.text, rules);
      if (rule === null) {
        continue;
      }
      if (line.kind === '+') {
        added.push({ file: file.path, line: line.newLine, rule });
      } else {
        removed.push({ file: file.oldPath, line: line.oldLine, rule });
      }
    }
  }
  return { added, removed };
}

const MAX_LISTED = 8;

/**
 * Judges the markers of a PR.
 *
 * @param {{ added: Marker[], removed: Marker[] }} markers - From `collectMarkers`.
 * @param {readonly string[]} labels - Labels of the PR.
 * @returns {{ status: 'pass' | 'warn' | 'fail', summary: string }} The status and a one-line text.
 */
export function judgeMarkers(markers, labels) {
  const net = markers.added.length - markers.removed.length;
  const counts = `${String(markers.added.length)} added, ${String(markers.removed.length)} removed`;
  if (markers.added.length === 0) {
    return {
      status: 'pass',
      summary: `no disable marker added (${String(markers.removed.length)} removed)`,
    };
  }
  const listed = markers.added
    .slice(0, MAX_LISTED)
    .map((entry) => `${entry.file}:${String(entry.line)} [${entry.rule}]`)
    .join(', ');
  const more =
    markers.added.length > MAX_LISTED
      ? `, and ${String(markers.added.length - MAX_LISTED)} more`
      : '';
  const text = `${counts}. Added: ${listed}${more}`;
  if (net <= 0) {
    return { status: 'pass', summary: `net ${String(net)} (${text})` };
  }
  if (labels.includes(LINT_EXCEPTION_LABEL)) {
    return {
      status: 'warn',
      summary: `net +${String(net)} (${text}). Allowed by the "${LINT_EXCEPTION_LABEL}" label.`,
    };
  }
  return {
    status: 'fail',
    summary: `net +${String(net)} (${text}). Remove the markers, or a human adds the "${LINT_EXCEPTION_LABEL}" label.`,
  };
}
