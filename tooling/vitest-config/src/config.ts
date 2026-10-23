import { defineConfig } from 'vitest/config';
import type { ViteUserConfig } from 'vitest/config';

/** Minimum coverage every project must meet. Lowering a value needs human approval (gate file). */
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
};

const isContinuousIntegration = process.env['CI'] === 'true';

/**
 * Builds the Vitest config shared by every project.
 *
 * @param options - Project-specific settings. Coverage thresholds cannot be changed.
 * @returns A Vitest config with v8 coverage and lcov output in `coverage/`.
 */
export function createVitestConfig(options: CreateVitestConfigOptions = {}): ViteUserConfig {
  const { environment = 'node', setupFiles = [], coverageExclude = [] } = options;

  return defineConfig({
    test: {
      environment,
      setupFiles: [...setupFiles],
      // `src/**` is temporary while tests move to `test/`. Remove it when the move ends.
      include: ['test/**/*.test.{ts,tsx,js,jsx}', 'src/**/*.test.{ts,tsx,js,jsx}'],
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
