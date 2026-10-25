// The list of all gate fixtures, in report order: plan section 11, then the rules of 2026-10-25,
// then the slow rows, then the rows that only CI can prove.
import {
  EDIT_HOOK_FIXTURES,
  GUARD_FIXTURES,
  SECRET_FIXTURES,
  VERIFY_FIXTURES,
} from './gate-fixtures-hooks.mjs';
import { COMMIT_FIXTURES, DEPENDENCY_FIXTURES, DIFF_FIXTURES } from './gate-fixtures-policy.mjs';
import { CI_LATER_FIXTURES, SLOW_FIXTURES } from './gate-fixtures-slow.mjs';
import {
  ANTI_SKIP_FIXTURES,
  LINT_FIXTURES,
  OPENGREP_FIXTURES,
  TEST_FIXTURES,
} from './gate-fixtures-source.mjs';

/**
 * Gives all fixtures in report order.
 *
 * @returns {import('./gate-fixtures-run.mjs').Fixture[]} The fixtures.
 */
export function allFixtures() {
  return [
    ...LINT_FIXTURES,
    ...OPENGREP_FIXTURES,
    ...ANTI_SKIP_FIXTURES,
    ...TEST_FIXTURES,
    ...EDIT_HOOK_FIXTURES,
    ...SECRET_FIXTURES,
    ...GUARD_FIXTURES,
    ...VERIFY_FIXTURES,
    ...DEPENDENCY_FIXTURES,
    ...COMMIT_FIXTURES,
    ...DIFF_FIXTURES,
    ...SLOW_FIXTURES,
    ...CI_LATER_FIXTURES,
  ];
}
