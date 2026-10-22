import vitest from '@vitest/eslint-plugin';
import { defineConfig } from 'eslint/config';
import playwright from 'eslint-plugin-playwright';

import { E2E_FILES, TEST_FILES } from './globs.js';

/**
 * Overrides for test files: Vitest rules on, size and style limits relaxed.
 *
 * @type {import('eslint').Linter.Config[]}
 */
export const test = defineConfig([
  {
    name: 'tooling/test',
    files: TEST_FILES,
    plugins: { vitest },
    rules: {
      'vitest/no-focused-tests': 'error',
      'vitest/no-disabled-tests': 'error',
      'vitest/expect-expect': 'error',
      'vitest/valid-expect': 'error',
      'vitest/no-identical-title': 'error',
      'vitest/no-commented-out-tests': 'error',
      'vitest/consistent-test-it': ['error', { fn: 'it', withinDescribe: 'it' }],
      'vitest/prefer-hooks-on-top': 'error',
      'max-lines-per-function': 'off',
      'max-lines': 'off',
      '@typescript-eslint/no-magic-numbers': 'off',
      '@typescript-eslint/consistent-type-assertions': [
        'error',
        { assertionStyle: 'as', objectLiteralTypeAssertions: 'allow' },
      ],
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-child-process': 'off',
      'import-x/no-extraneous-dependencies': ['error', { devDependencies: true }],
    },
  },
  {
    // Playwright specs live in <web>/e2e/. Vitest never runs them.
    name: 'tooling/e2e',
    files: E2E_FILES,
    extends: [playwright.configs['flat/recommended']],
    rules: {
      'vitest/expect-expect': 'off',
      'vitest/consistent-test-it': 'off',
      'playwright/no-skipped-test': 'error',
      'playwright/no-focused-test': 'error',
      'playwright/expect-expect': 'error',
    },
  },
]);
