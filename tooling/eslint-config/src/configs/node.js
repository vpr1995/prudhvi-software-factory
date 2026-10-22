import { defineConfig } from 'eslint/config';
import n from 'eslint-plugin-n';
import globals from 'globals';

import { ALL_CODE_FILES } from './globs.js';

/**
 * Node.js rules for api, infra, scripts and tooling code.
 *
 * @type {import('eslint').Linter.Config[]}
 */
export const node = defineConfig([
  {
    name: 'tooling/node',
    files: ALL_CODE_FILES,
    plugins: { n },
    languageOptions: { globals: globals.node },
    rules: {
      'n/no-process-exit': 'error',
      'n/no-deprecated-api': 'error',
      'n/no-path-concat': 'error',
      'n/handle-callback-err': 'error',
      'n/prefer-node-protocol': 'error',
      'n/prefer-promises/fs': 'error',
      'n/prefer-promises/dns': 'error',
      'n/hashbang': 'error',
    },
  },
]);
