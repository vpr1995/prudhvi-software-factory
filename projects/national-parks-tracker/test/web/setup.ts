import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

// next.config.ts sets `trailingSlash: true`, and `next build` passes it to `next/link` in this
// variable. The tests set it too, so links render as they do on the site, for example `/parks/zion/`.
beforeEach(() => {
  vi.stubEnv('__NEXT_TRAILING_SLASH', 'true');
});

afterEach(() => {
  cleanup();
});
