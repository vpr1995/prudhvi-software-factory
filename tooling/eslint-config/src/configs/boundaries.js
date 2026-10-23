import { createRequire } from 'node:module';

import { defineConfig } from 'eslint/config';
import boundariesPlugin from 'eslint-plugin-boundaries';

import { ALL_CODE_FILES } from './globs.js';

// boundaries loads resolvers relative to the linted file, where this package is not installed.
// An absolute path avoids that.
const TYPESCRIPT_RESOLVER = createRequire(import.meta.url).resolve(
  'eslint-import-resolver-typescript',
);

const REPO_ROOT = new URL('../../../../', import.meta.url).pathname;

// Order matters: the first matching descriptor wins, so specific api folders come before `api`.
const ELEMENTS = [
  {
    type: 'contracts',
    pattern: 'projects/*/src/contracts',
    capture: ['project'],
    partialMatch: false,
  },
  {
    type: 'api-domain',
    pattern: 'projects/*/src/api/domain',
    capture: ['project'],
    partialMatch: false,
  },
  {
    type: 'api-adapters',
    pattern: 'projects/*/src/api/adapters',
    capture: ['project'],
    partialMatch: false,
  },
  { type: 'api', pattern: 'projects/*/src/api', capture: ['project'], partialMatch: false },
  { type: 'web', pattern: 'projects/*/web', capture: ['project'], partialMatch: false },
  // The CDK app of a project: bin/ holds the app, lib/ holds the stacks and constructs.
  { type: 'infra', pattern: 'projects/*/bin', capture: ['project'], partialMatch: false },
  { type: 'infra', pattern: 'projects/*/lib', capture: ['project'], partialMatch: false },
  { type: 'platform-infra', pattern: 'platform/infra', partialMatch: false },
  { type: 'shared', pattern: 'packages/*', capture: ['package'], partialMatch: false },
  { type: 'tooling', pattern: 'tooling/*', capture: ['tool'], partialMatch: false },
];

const API_TYPES = ['api', 'api-domain', 'api-adapters'];
const SAME_PROJECT = { captured: { project: '{{from.element.captured.project}}' } };
const ALL_LOCAL_PROJECT_TYPES = [
  'contracts',
  ...API_TYPES,
  'web',
  'infra',
  'platform-infra',
  'shared',
];
const FASTIFY = ['fastify', 'fastify-*', '@fastify/*'];

/**
 * Policies for `boundaries/dependencies`. The last matching policy wins, so each source type
 * first loses every local import and then gets back only what it may import.
 *
 * @returns {object[]} Policies.
 */
function createPolicies() {
  const denyAllLocal = (/** @type {string[]} */ types) => ({
    from: { element: { type: types } },
    disallow: { to: { element: { type: ALL_LOCAL_PROJECT_TYPES } } },
  });
  const allow = (/** @type {string[]} */ from, /** @type {object[]} */ to) => ({
    from: { element: { type: from } },
    allow: { to },
  });
  const ownContracts = { element: { type: 'contracts', ...SAME_PROJECT } };
  const shared = { element: { type: 'shared' } };

  return [
    denyAllLocal(['web', ...API_TYPES, 'infra', 'contracts', 'platform-infra', 'shared']),
    allow(['web'], [ownContracts, shared]),
    allow(
      ['api'],
      [
        ownContracts,
        shared,
        { element: { type: ['api-domain', 'api-adapters'], ...SAME_PROJECT } },
      ],
    ),
    allow(
      ['api-adapters'],
      [ownContracts, shared, { element: { type: 'api-domain', ...SAME_PROJECT } }],
    ),
    allow(['api-domain'], [ownContracts, shared]),
    {
      from: { element: { type: 'infra' } },
      allow: {
        to: [
          { element: { type: 'shared', captured: { package: 'cdk-constructs' } } },
          ownContracts,
        ],
      },
    },
    {
      // Infra uses contracts as types only. Runtime values must not leak into synth.
      from: { element: { type: 'infra' } },
      dependency: { kind: 'value' },
      disallow: { to: { element: { type: 'contracts' } } },
      message: 'infra may import contracts as types only. Use `import type`.',
    },
    allow(
      ['platform-infra'],
      [{ element: { type: 'shared', captured: { package: 'cdk-constructs' } } }],
    ),
    allow(['shared'], [shared]),
    // Contracts: only zod. Tests may use the test runner.
    {
      from: { element: { type: 'contracts' } },
      disallow: { to: { module: { origin: ['external', 'core'] } } },
      message: 'contracts may import only zod.',
    },
    {
      from: { element: { type: 'contracts' } },
      allow: { to: { module: { source: 'zod' } } },
    },
    {
      from: { element: { type: 'contracts' }, file: { categories: 'test' } },
      allow: { to: { module: { origin: ['external', 'core'] } } },
    },
    {
      from: { element: { type: 'api-domain' } },
      disallow: { to: { module: { source: FASTIFY } } },
      message: 'api domain code is pure. It must not import fastify.',
    },
    {
      from: { element: { type: 'web' } },
      disallow: { to: { module: { source: [...FASTIFY, 'aws-cdk-lib'] } } },
      message: 'web must not import server or CDK libraries.',
    },
    // Nobody imports platform/infra. Same-element imports and every config file stay allowed.
    {
      from: { element: { type: '!platform-infra' } },
      disallow: { to: { element: { type: 'platform-infra' } } },
      message: 'Nothing may import platform/infra. Share values through SSM at deploy time.',
    },
    { allow: { dependency: { relationship: { to: 'internal' } } } },
    { allow: { to: { element: { type: 'tooling' } } } },
  ];
}

/**
 * Creates the boundaries config. Element types come from the path: `projects/<name>/src/(contracts|api)`,
 * `projects/<name>/web`, `projects/<name>/(bin|lib)`, `platform/infra`, `packages/*` and `tooling/*`.
 *
 * @param {{ rootPath?: string }} [options] - `rootPath` is the repo root. It defaults to this repo.
 * @returns {import('eslint').Linter.Config[]} Config blocks.
 */
export function boundaries({ rootPath = REPO_ROOT } = {}) {
  return defineConfig([
    {
      name: 'tooling/boundaries',
      files: ALL_CODE_FILES,
      plugins: { boundaries: boundariesPlugin },
      settings: {
        'boundaries/root-path': rootPath,
        'boundaries/elements': ELEMENTS,
        'boundaries/files': [{ pattern: '**/*.test.{ts,tsx,js}', category: 'test' }],
        'import/resolver': { [TYPESCRIPT_RESOLVER]: { alwaysTryTypes: true } },
      },
      rules: {
        'boundaries/dependencies': ['error', { default: 'allow', policies: createPolicies() }],
        'boundaries/no-unknown': 'off',
      },
    },
  ]);
}
