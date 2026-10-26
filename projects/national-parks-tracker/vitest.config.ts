import { fileURLToPath } from 'node:url';

import { createVitestConfig } from '@vprprudhvi/tooling-vitest-config';
import { defineConfig } from 'vitest/config';
import type { TestProjectInlineConfiguration } from 'vitest/config';

// One config for the whole package. The shared factory gives the fixed settings and the coverage
// thresholds. Two Vitest projects split the environments: `node` for test/contracts, test/data
// (the data files), test/e2e (the e2e static server) and test/infra (the CDK app in bin and lib),
// and `web` (jsdom) for test/web. Coverage runs once over both. The thresholds apply to the sum,
// and again to each folder, so the web app cannot hide behind the contracts. Playwright runs the
// specs in web/e2e, so Vitest skips them.
const shared = createVitestConfig().test ?? {};
const { coverage = {}, reporters = ['default'], outputFile = {}, ...projectOptions } = shared;
const { thresholds = {} } = coverage;
const IGNORED_FILES = ['**/node_modules/**', '**/dist/**', '**/.next/**', 'web/e2e/**'];

// web/lib/data.ts imports the visits file through the `@npt/visits` alias (next.config.ts sets it
// for the build). The tests use the real file, like the production build.
const resolve = {
  alias: {
    '@npt/visits': fileURLToPath(new URL('web/data/visits.json', import.meta.url)),
  },
};

const nodeProject: TestProjectInlineConfiguration = {
  resolve,
  test: {
    ...projectOptions,
    name: 'node',
    environment: 'node',
    include: [
      'test/contracts/**/*.test.ts',
      'test/data/**/*.test.ts',
      'test/e2e/**/*.test.js',
      'test/infra/**/*.test.ts',
    ],
    exclude: IGNORED_FILES,
  },
};

const webProject: TestProjectInlineConfiguration = {
  resolve,
  // The nextjs tsconfig keeps `jsx` on `react-jsx` for Next.js. Vite needs the same setting for TSX.
  esbuild: { jsx: 'automatic' },
  test: {
    ...projectOptions,
    name: 'web',
    environment: 'jsdom',
    setupFiles: ['./test/web/setup.ts'],
    include: ['test/web/**/*.test.{ts,tsx}'],
    exclude: IGNORED_FILES,
  },
};

export default defineConfig({
  test: {
    reporters,
    outputFile,
    projects: [nodeProject, webProject],
    coverage: {
      ...coverage,
      include: ['src/contracts/**/*.ts', 'bin/**/*.ts', 'lib/**/*.ts', 'web/**/*.{ts,tsx}'],
      exclude: [
        '**/*.test.{ts,tsx,js,jsx}',
        '**/*.d.ts',
        'web/next.config.ts',
        'web/e2e/**',
        'web/.next/**',
        'web/out/**',
        'web/out-e2e/**',
      ],
      thresholds: {
        ...thresholds,
        'src/**': { ...thresholds },
        'lib/**': { ...thresholds },
        'web/**': { ...thresholds },
      },
    },
  },
});
