/** Gate file. Second layer for the import rules that eslint-plugin-boundaries enforces. */

const PROJECT = '^projects/([^/]+)';
// The `test/` folder of a Rush project mirrors its source folders: test/api, test/web, test/infra.
const TEST_FOLDER = '^((projects|packages|tooling)/[^/]+|platform/infra)/test/';

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular imports make code hard to change and test.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment: 'A module that nothing imports is probably dead code.',
      from: {
        orphan: true,
        pathNot: [
          '(^|/)\\.[^/]+\\.(js|cjs|mjs|ts|json)$',
          '\\.d\\.ts$',
          '(^|/)(tsconfig|vitest\\.config|eslint\\.config|next\\.config|playwright\\.config)[^/]*\\.(js|cjs|mjs|ts|json)$',
          '\\.test\\.(ts|tsx)$',
          '(^|/)test/',
          '(^|/)src/index\\.(ts|js)$',
          '(^|/)(page|layout|route|loading|error|not-found|template|default)\\.tsx?$',
          '(^|/)cdk\\.json$',
          '(^|/)bin/[^/]+\\.ts$',
        ],
      },
      to: {},
    },
    {
      name: 'no-cross-project-imports',
      severity: 'error',
      comment: 'A project never imports another project. Move shared code to packages/*.',
      from: { path: PROJECT },
      to: { path: PROJECT, pathNot: '^projects/$1/' },
    },
    {
      name: 'web-not-api',
      severity: 'error',
      comment: 'web must not import api code.',
      from: { path: '^projects/[^/]+/(web|test/web)/' },
      to: { path: '^projects/[^/]+/src/api(-py|-go)?/' },
    },
    {
      name: 'api-not-web',
      severity: 'error',
      comment: 'api must not import web code.',
      from: { path: '^projects/[^/]+/(src/api|test/api)/' },
      to: { path: '^projects/[^/]+/web/' },
    },
    {
      name: 'contracts-are-leaf',
      severity: 'error',
      comment:
        'contracts may import only zod. No imports from web, api, infra, packages or platform.',
      from: { path: '^projects/[^/]+/(src/contracts|test/contracts)/' },
      to: {
        path: '^(projects/[^/]+/(web|src/api|bin|lib)|packages|platform|tooling)/',
      },
    },
    {
      name: 'api-domain-is-pure',
      severity: 'error',
      comment: 'api domain code must not import adapters.',
      from: { path: '^projects/[^/]+/(src/api|test/api)/domain/' },
      to: { path: '^projects/[^/]+/src/api/adapters/' },
    },
    {
      name: 'infra-only-contracts-and-cdk-constructs',
      severity: 'error',
      comment:
        'infra (bin and lib) may import its own contracts and packages/cdk-constructs. Never web, api or platform/infra.',
      from: { path: '^projects/[^/]+/((bin|lib)|test/infra)/' },
      to: {
        path: '^(projects/[^/]+/(web|src/api)/|platform/infra/|packages/(?!cdk-constructs/))',
      },
    },
    {
      name: 'lib-not-bin',
      severity: 'error',
      comment: 'The app in bin/ imports lib/. lib/ (stacks and constructs) must not import bin/.',
      from: { path: '^projects/[^/]+/lib/' },
      to: { path: '^projects/[^/]+/bin/' },
    },
    {
      name: 'no-import-of-test-files',
      severity: 'error',
      comment: 'Nothing imports a test file. Source code must not depend on test code.',
      from: { pathNot: '(^|/)test/' },
      to: { path: TEST_FOLDER },
    },
    {
      name: 'tests-stay-in-own-package',
      severity: 'error',
      comment:
        'A test imports test helpers only from the test folder of its own package or project.',
      from: { path: '^((projects|packages|tooling)/[^/]+|platform/infra)/test/' },
      to: { path: TEST_FOLDER, pathNot: '^$1/test/' },
    },
    {
      name: 'packages-not-projects',
      severity: 'error',
      comment: 'Shared packages never import from projects or platform.',
      from: { path: '^packages/' },
      to: { path: '^(projects|platform)/' },
    },
    {
      name: 'platform-infra-isolated',
      severity: 'error',
      comment:
        'platform/infra imports only packages/cdk-constructs. Nothing imports platform/infra.',
      from: { pathNot: '^platform/infra/' },
      to: { path: '^platform/infra/' },
    },
    {
      name: 'platform-infra-imports',
      severity: 'error',
      comment: 'platform/infra imports only packages/cdk-constructs.',
      from: { path: '^platform/infra/' },
      to: { path: '^(projects|packages/(?!cdk-constructs/))' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(dist|coverage|cdk\\.out|\\.next)/' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
