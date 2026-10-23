import { createVitestConfig } from '@vprprudhvi/tooling-vitest-config';
import { defineConfig } from 'vitest/config';
import type { TestProjectInlineConfiguration } from 'vitest/config';

// One config for the whole package. The shared factory gives the fixed settings and the coverage
// thresholds. Two Vitest projects split the environments: `node` for test/api and test/contracts,
// and `web` (jsdom) for test/web. Coverage runs once over both. The thresholds apply to the sum,
// and again to each folder, so the web app cannot hide behind the API (or the reverse).
const shared = createVitestConfig().test ?? {};
const { coverage = {}, reporters = ['default'], outputFile = {}, ...projectOptions } = shared;
const { thresholds = {} } = coverage;
const IGNORED_FILES = ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/e2e/**'];

const nodeProject: TestProjectInlineConfiguration = {
  test: {
    ...projectOptions,
    name: 'node',
    environment: 'node',
    include: ['test/api/**/*.test.{ts,tsx}', 'test/contracts/**/*.test.{ts,tsx}'],
    exclude: IGNORED_FILES,
  },
};

const webProject: TestProjectInlineConfiguration = {
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
      // Not src/**: the Python and Go parts live in src/api-py and src/api-go and hold no TypeScript.
      include: ['src/contracts/**/*.ts', 'src/api/**/*.ts', 'web/**/*.{ts,tsx}'],
      exclude: [
        '**/*.test.{ts,tsx,js,jsx}',
        '**/*.d.ts',
        'web/next.config.ts',
        'web/e2e/**',
        'web/.next/**',
      ],
      thresholds: {
        ...thresholds,
        'src/**': { ...thresholds },
        'web/**': { ...thresholds },
      },
    },
  },
});
