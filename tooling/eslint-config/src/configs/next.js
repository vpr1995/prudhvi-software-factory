import nextPlugin from '@next/eslint-plugin-next';
import { defineConfig } from 'eslint/config';

import { ALL_CODE_FILES } from './globs.js';
import { reactConfig } from './react.js';

/**
 * Next.js rules (App Router). Includes the `react` config.
 *
 * @type {import('eslint').Linter.Config[]}
 */
export const next = defineConfig([
  ...reactConfig,
  {
    name: 'tooling/next',
    files: ALL_CODE_FILES,
    extends: [nextPlugin.configs['core-web-vitals']],
    // App Router only: the rule looks for a pages/ directory.
    rules: { '@next/next/no-html-link-for-pages': 'off' },
  },
]);
