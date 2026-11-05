import { defineConfig } from 'vitest/config';
import type { TestProjectInlineConfiguration, ViteUserConfig } from 'vitest/config';

/** Minimum coverage every project must meet. Lowering a value needs human approval. */
export const COVERAGE_THRESHOLDS = {
  lines: 80,
  branches: 75,
  functions: 80,
  statements: 80,
} as const;

/** Options a project may set. Thresholds and reporters are fixed on purpose. */
export type CreateVitestConfigOptions = {
  /** Test environment. Defaults to `node`. */
  readonly environment?: 'node' | 'jsdom' | 'happy-dom';
  /** Files that run before each test file, for example Testing Library setup. */
  readonly setupFiles?: readonly string[];
  /** Extra globs excluded from coverage, for example generated code. */
  readonly coverageExclude?: readonly string[];
  /**
   * Time limit for each test, in milliseconds. Use it only for slow tests, for example CDK synth.
   * When you do not set it, Vitest uses its default (5000 ms).
   */
  readonly testTimeout?: number;
};

const isContinuousIntegration = process.env['CI'] === 'true';

/**
 * Builds the Vitest config shared by every project.
 *
 * @param options - Project-specific settings. Coverage thresholds cannot be changed.
 * @returns A Vitest config with v8 coverage and lcov output in `coverage/`.
 */
export function createVitestConfig(options: CreateVitestConfigOptions = {}): ViteUserConfig {
  const { environment = 'node', setupFiles = [], coverageExclude = [], testTimeout } = options;

  return defineConfig({
    test: {
      environment,
      setupFiles: [...setupFiles],
      // Only a project that sets the option gets a time limit. The others keep the Vitest default.
      ...(testTimeout === undefined ? {} : { testTimeout }),
      // Tests live in the `test/` folder at the project root. A test elsewhere never runs.
      include: ['test/**/*.test.{ts,tsx,js,jsx}'],
      exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
      globals: false,
      passWithNoTests: false,
      restoreMocks: true,
      unstubEnvs: true,
      unstubGlobals: true,
      reporters: isContinuousIntegration ? ['default', 'junit'] : ['default'],
      outputFile: { junit: 'coverage/junit.xml' },
      coverage: {
        provider: 'v8',
        reportsDirectory: 'coverage',
        reporter: ['text-summary', 'lcov', 'json-summary'],
        include: ['src/**/*.{ts,tsx,js,jsx}'],
        exclude: ['src/**/*.test.{ts,tsx,js,jsx}', 'src/**/*.d.ts', ...coverageExclude],
        thresholds: { ...COVERAGE_THRESHOLDS },
      },
    },
  });
}

/** Options for a CDK app project (bin, lib, src, optional web). Thresholds and reporters are fixed. */
export type CreateAppVitestConfigOptions = {
  /** Add a `web` test set (jsdom, `test/web`) and measure coverage on `web/`. Defaults to false. */
  readonly web?: boolean;
  /** Time limit for each test, in milliseconds. Defaults to 30 000. */
  readonly testTimeout?: number;
  /** Vite `resolve.alias` for every test set, for example a JSON file that the build maps. */
  readonly alias?: Readonly<Record<string, string>>;
  /** Extra globs excluded from coverage, for example generated code. */
  readonly coverageExclude?: readonly string[];
};

// CDK synth is CPU-heavy. On the CI runner, 5000 ms is too short (owner decision 2026-11-04).
const APP_TEST_TIMEOUT_MS = 30_000;
const APP_IGNORED_FILES = ['**/node_modules/**', '**/dist/**', '**/.next/**', 'web/e2e/**'];

/**
 * Builds the Vitest config for a CDK app project. It extends `createVitestConfig`.
 *
 * Test sets: `node` runs every test in `test/` except `test/web`. With `web`, a `web` set (jsdom)
 * runs `test/web`. Coverage runs once over all sets. The thresholds apply to the sum and again to
 * each folder, so one part cannot hide behind another.
 *
 * @param options - Project-specific settings. Coverage thresholds cannot be changed.
 * @returns A Vitest config with v8 coverage and lcov output in `coverage/`.
 */
export function createAppVitestConfig(options: CreateAppVitestConfigOptions = {}): ViteUserConfig {
  const {
    web: hasWeb = false,
    testTimeout = APP_TEST_TIMEOUT_MS,
    alias = {},
    coverageExclude = [],
  } = options;
  const shared = createVitestConfig({ testTimeout }).test ?? {};
  const { coverage = {}, reporters = ['default'], outputFile = {}, ...projectOptions } = shared;
  const { thresholds = {} } = coverage;
  const resolve = { alias: { ...alias } };

  const nodeProject: TestProjectInlineConfiguration = {
    resolve,
    test: {
      ...projectOptions,
      name: 'node',
      environment: 'node',
      include: ['test/**/*.test.{ts,tsx,js}'],
      exclude: [...APP_IGNORED_FILES, 'test/web/**'],
    },
  };

  const webProject: TestProjectInlineConfiguration = {
    resolve,
    // The web tsconfig keeps `jsx` on `react-jsx` for Next.js. Vite needs the same setting for TSX.
    esbuild: { jsx: 'automatic' },
    test: {
      ...projectOptions,
      name: 'web',
      environment: 'jsdom',
      setupFiles: ['./test/web/setup.ts'],
      include: ['test/web/**/*.test.{ts,tsx}'],
      exclude: APP_IGNORED_FILES,
    },
  };

  return defineConfig({
    test: {
      reporters,
      outputFile,
      projects: hasWeb ? [nodeProject, webProject] : [nodeProject],
      coverage: {
        ...coverage,
        include: [
          'src/**/*.ts',
          'bin/**/*.ts',
          'lib/**/*.ts',
          ...(hasWeb ? ['web/**/*.{ts,tsx}'] : []),
        ],
        exclude: [
          '**/*.test.{ts,tsx,js,jsx}',
          '**/*.d.ts',
          'web/next.config.ts',
          'web/e2e/**',
          'web/.next/**',
          'web/out/**',
          'web/out-e2e/**',
          ...coverageExclude,
        ],
        thresholds: {
          ...thresholds,
          'src/**': { ...thresholds },
          'lib/**': { ...thresholds },
          ...(hasWeb ? { 'web/**': { ...thresholds } } : {}),
        },
      },
    },
  });
}
