import { defineConfig } from 'eslint/config';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import noUnsanitized from 'eslint-plugin-no-unsanitized';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

import { namingConvention } from '../naming.js';

import { ALL_CODE_FILES, TS_FILES } from './globs.js';

// eslint-plugin-react 7.37.5 cannot use `version: 'detect'` on ESLint 10 (it calls the removed
// context.getFilename). Keep this in step with the React major in the web projects.
const REACT_VERSION = '19.2';

/**
 * React rules for web code: React, hooks, accessibility and DOM sanitizing.
 *
 * @type {import('eslint').Linter.Config[]}
 */
export const reactConfig = defineConfig([
  {
    name: 'tooling/react',
    files: ALL_CODE_FILES,
    extends: [
      react.configs.flat['recommended'],
      react.configs.flat['jsx-runtime'],
      reactHooks.configs.flat['recommended-latest'],
      jsxA11y.flatConfigs.recommended,
    ],
    plugins: { 'no-unsanitized': noUnsanitized },
    languageOptions: { globals: { ...globals.browser } },
    settings: { react: { version: REACT_VERSION } },
    rules: {
      'react/prop-types': 'off',
      'react/jsx-pascal-case': 'error',
      'react/no-danger': 'error',
      'react/jsx-no-target-blank': 'error',
      'react/self-closing-comp': 'error',
      'react/function-component-definition': ['error', { namedComponents: 'function-declaration' }],
      'no-unsanitized/method': 'error',
      'no-unsanitized/property': 'error',
    },
  },
  {
    name: 'tooling/react-naming',
    files: TS_FILES,
    rules: {
      '@typescript-eslint/naming-convention': namingConvention({ typed: true, react: true }),
    },
  },
]);
