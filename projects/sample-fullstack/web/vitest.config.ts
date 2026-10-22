import { createVitestConfig } from '@vprprudhvi/tooling-vitest-config';
import { mergeConfig } from 'vitest/config';

// The nextjs tsconfig keeps `jsx` on `react-jsx` for Next.js. Vite needs the same setting for TSX.
export default mergeConfig(
  createVitestConfig({ environment: 'jsdom', setupFiles: ['./test/setup.ts'] }),
  { esbuild: { jsx: 'automatic' } },
);
