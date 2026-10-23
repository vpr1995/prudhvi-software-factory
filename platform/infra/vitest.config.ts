import { createVitestConfig } from '@vprprudhvi/tooling-vitest-config';
import { defineConfig } from 'vitest/config';

// The shared factory looks in src/**. This package keeps the CDK app in bin/ and lib/, so it moves
// the test and coverage globs. The thresholds, the reporters and the other settings stay as they are.
const { coverage = {}, ...shared } = createVitestConfig().test ?? {};

export default defineConfig({
  test: {
    ...shared,
    include: ['bin/**/*.test.ts', 'lib/**/*.test.ts'],
    coverage: {
      ...coverage,
      include: ['bin/**/*.ts', 'lib/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.d.ts'],
    },
  },
});
