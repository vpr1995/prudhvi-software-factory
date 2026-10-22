import js from '@eslint/js';
import eslintComments from '@eslint-community/eslint-plugin-eslint-comments';
import { defineConfig, globalIgnores } from 'eslint/config';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import { importX } from 'eslint-plugin-import-x';
import jsdoc from 'eslint-plugin-jsdoc';
import promise from 'eslint-plugin-promise';
import security from 'eslint-plugin-security';
import sonarjs from 'eslint-plugin-sonarjs';
import unicorn from 'eslint-plugin-unicorn';
import tseslint from 'typescript-eslint';

import { namingConvention } from '../naming.js';
import { localPlugin } from '../plugin.js';
import {
  CONFIG_FILES,
  INDEX_FILES,
  SHARED_SYNTAX_RULES,
  restrictedSyntaxBlocks,
} from '../restricted-syntax.js';

import {
  ALL_CODE_FILES,
  DEFAULT_EXPORT_FILES,
  IGNORED_PATHS,
  JS_FILES,
  TS_FILES,
} from './globs.js';

const MAX_COGNITIVE_COMPLEXITY = 15;
const MAX_FILE_LINES = 400;
const MAX_FUNCTION_LINES = 80;
const MAX_PARAMETERS = 3;
const MAX_NESTING_DEPTH = 3;

const lineLimitOptions = { skipBlankLines: true, skipComments: true };

const unicornRules = {
  'unicorn/filename-case': ['error', { case: 'kebabCase', ignore: [/^\[.*\]$/] }],
  'unicorn/name-replacements': [
    'error',
    {
      checkFilenames: false,
      allowList: {
        id: true,
        Id: true,
        url: true,
        Url: true,
        api: true,
        Api: true,
        db: true,
        Db: true,
        env: true,
        Env: true,
        config: true,
        Config: true,
        props: true,
        Props: true,
        ref: true,
        Ref: true,
        params: true,
        Params: true,
        args: true,
        Args: true,
      },
    },
  ],
  'unicorn/prefer-node-protocol': 'error',
  'unicorn/no-for-each': 'error',
  'unicorn/prefer-single-call': 'error',
  'unicorn/no-new-array': 'error',
  'unicorn/no-process-exit': 'error',
  'unicorn/no-useless-undefined': 'error',
  'unicorn/no-await-in-promise-methods': 'error',
  'unicorn/prefer-at': 'error',
  'unicorn/prefer-includes': 'error',
  'unicorn/prefer-optional-catch-binding': 'error',
  'unicorn/prefer-set-has': 'error',
  'unicorn/prefer-string-replace-all': 'error',
  'unicorn/prefer-structured-clone': 'error',
  'unicorn/throw-new-error': 'error',
  'unicorn/error-message': 'error',
};

const sonarRules = {
  'sonarjs/cognitive-complexity': ['error', MAX_COGNITIVE_COMPLEXITY],
  'sonarjs/no-commented-code': 'error',
  'sonarjs/no-identical-functions': 'error',
  'sonarjs/no-collapsible-if': 'error',
  'sonarjs/no-duplicated-branches': 'error',
  'sonarjs/no-inverted-boolean-check': 'error',
  'sonarjs/prefer-immediate-return': 'error',
};

const coreRules = {
  eqeqeq: ['error', 'always'],
  'prefer-const': 'error',
  'no-var': 'error',
  'no-else-return': 'error',
  'no-console': 'error',
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error',
  'max-depth': ['error', MAX_NESTING_DEPTH],
  'max-params': ['error', MAX_PARAMETERS],
  'max-lines': ['error', { max: MAX_FILE_LINES, ...lineLimitOptions }],
  'max-lines-per-function': [
    'error',
    { max: MAX_FUNCTION_LINES, ...lineLimitOptions, IIFEs: true },
  ],
  'no-restricted-imports': [
    'error',
    {
      paths: [
        { name: 'lodash', message: 'Do not import the full lodash package. Use a native method.' },
        {
          name: 'lodash-es',
          message: 'Do not import the full lodash package. Use a native method.',
        },
        { name: 'moment', message: 'moment is banned. Use the Temporal API or Date.' },
        { name: 'moment-timezone', message: 'moment is banned. Use the Temporal API or Date.' },
      ],
    },
  ],
};

const importRules = {
  'import-x/no-default-export': 'error',
  'import-x/no-cycle': 'error',
  'import-x/no-self-import': 'error',
  'import-x/no-duplicates': 'error',
  'import-x/no-useless-path-segments': 'error',
  'import-x/first': 'error',
  'import-x/no-extraneous-dependencies': 'error',
  'import-x/order': [
    'error',
    {
      // Order: node built-ins, external, @vprprudhvi/shared-*, own project, relative.
      groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
      pathGroups: [{ pattern: '@vprprudhvi/shared-*', group: 'external', position: 'after' }],
      pathGroupsExcludedImportTypes: ['builtin'],
      'newlines-between': 'always',
      alphabetize: { order: 'asc', caseInsensitive: true },
    },
  ],
};

const typeScriptRules = {
  '@typescript-eslint/ban-ts-comment': [
    'error',
    {
      'ts-ignore': true,
      'ts-nocheck': true,
      'ts-check': false,
      'ts-expect-error': 'allow-with-description',
      minimumDescriptionLength: 10,
    },
  ],
  '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
  '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
  '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'separate-type-imports' }],
  '@typescript-eslint/explicit-module-boundary-types': 'error',
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/no-non-null-assertion': 'error',
  '@typescript-eslint/no-floating-promises': 'error',
  '@typescript-eslint/no-misused-promises': 'error',
  '@typescript-eslint/only-throw-error': 'error',
  '@typescript-eslint/switch-exhaustiveness-check': ['error', { requireDefaultForNonUnion: true }],
  '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
  '@typescript-eslint/no-magic-numbers': [
    'error',
    {
      ignore: [0, 1, -1],
      ignoreArrayIndexes: true,
      ignoreDefaultValues: true,
      ignoreNumericLiteralTypes: true,
      ignoreTypeIndexes: true,
      ignoreReadonlyClassProperties: true,
      enforceConst: true,
    },
  ],
  '@typescript-eslint/no-unused-vars': [
    'error',
    { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
  ],
  '@typescript-eslint/prefer-readonly-parameter-types': 'off',
  'jsdoc/require-jsdoc': [
    'error',
    {
      publicOnly: true,
      require: {
        FunctionDeclaration: true,
        ArrowFunctionExpression: true,
        FunctionExpression: true,
        ClassDeclaration: true,
      },
      contexts: ['TSTypeAliasDeclaration'],
    },
  ],
};

const commentRules = {
  '@eslint-community/eslint-comments/require-description': ['error', { ignore: [] }],
  '@eslint-community/eslint-comments/no-unlimited-disable': 'error',
  '@eslint-community/eslint-comments/disable-enable-pair': 'error',
  '@eslint-community/eslint-comments/no-duplicate-disable': 'error',
  'local/todo-with-issue': 'error',
};

// detect-object-injection flags every `object[key]`. It is too noisy to keep at error level.
const securityRules = Object.fromEntries(
  Object.entries(security.configs.recommended.rules).filter(
    ([name]) => name !== 'security/detect-object-injection',
  ),
);

/**
 * Base config for every TypeScript and JavaScript file. Use first, then add `node`, `react`, `next`, `cdk` and `test`.
 *
 * @type {import('eslint').Linter.Config[]}
 */
export const base = defineConfig([
  globalIgnores(IGNORED_PATHS),
  {
    name: 'tooling/linter-options',
    linterOptions: { reportUnusedDisableDirectives: 'error', reportUnusedInlineConfigs: 'error' },
  },
  { name: 'tooling/js-recommended', files: ALL_CODE_FILES, extends: [js.configs.recommended] },
  {
    name: 'tooling/typescript',
    files: TS_FILES,
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: { parserOptions: { projectService: true } },
    rules: {
      ...typeScriptRules,
      '@typescript-eslint/naming-convention': namingConvention({ typed: true, react: false }),
    },
  },
  {
    name: 'tooling/javascript',
    files: JS_FILES,
    plugins: { '@typescript-eslint': tseslint.plugin },
    extends: [tseslint.configs.disableTypeChecked],
    // naming-convention needs the TypeScript parser's services even without type information.
    languageOptions: { parser: tseslint.parser },
    rules: {
      'no-throw-literal': 'error',
      '@typescript-eslint/naming-convention': namingConvention({ typed: false, react: false }),
    },
  },
  {
    name: 'tooling/shared-rules',
    files: ALL_CODE_FILES,
    plugins: {
      'import-x': importX,
      unicorn,
      sonarjs,
      security,
      promise,
      jsdoc,
      '@eslint-community/eslint-comments': eslintComments,
      local: localPlugin,
    },
    settings: {
      'import-x/resolver-next': [createTypeScriptImportResolver({ alwaysTryTypes: true })],
      'import-x/internal-regex':
        '^@vprprudhvi/(?!shared-|tooling-|platform-)[a-z0-9-]+-(contracts|web|api|infra)(/|$)',
    },
    rules: {
      ...coreRules,
      ...importRules,
      ...unicornRules,
      ...sonarRules,
      ...securityRules,
      ...commentRules,
      'promise/prefer-await-to-then': 'error',
      'local/zod-schema-naming': 'error',
    },
  },
  {
    name: 'tooling/allow-default-exports',
    files: DEFAULT_EXPORT_FILES,
    rules: { 'import-x/no-default-export': 'off' },
  },
  ...restrictedSyntaxBlocks(SHARED_SYNTAX_RULES, [
    { files: CONFIG_FILES, skip: ['process-env'] },
    { files: INDEX_FILES, skip: ['barrel'] },
  ]),
]);
