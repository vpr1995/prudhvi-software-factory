import { fileURLToPath } from 'node:url';

import type { NextConfig } from 'next';

// The Rush workspace keeps packages in common/temp/node_modules. Next.js must see the whole repo
// as its file root, or it cannot find `next` through the pnpm symlinks.
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  outputFileTracingRoot: REPO_ROOT,
  turbopack: { root: REPO_ROOT },
};

export default nextConfig;
