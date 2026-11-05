import { createVitestConfig } from '@vprprudhvi/tooling-vitest-config';
import { defineConfig } from 'vitest/config';

// The shared factory measures coverage in src/**. This package keeps the CDK app in bin/ and lib/,
// so it moves the coverage globs. Tests live in test/. The thresholds, the reporters and the other
// settings stay as they are.
// CDK synth is CPU-heavy. On the CI runner, 5000 ms is too short (owner decision 2026-11-04).
const CDK_SYNTH_TEST_TIMEOUT_MS = 30_000;
const { coverage = {}, ...shared } =
  createVitestConfig({ testTimeout: CDK_SYNTH_TEST_TIMEOUT_MS }).test ?? {};

export default defineConfig({
  test: {
    ...shared,
    include: ['test/**/*.test.ts'],
    coverage: {
      ...coverage,
      include: ['bin/**/*.ts', 'lib/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.d.ts'],
    },
  },
});
