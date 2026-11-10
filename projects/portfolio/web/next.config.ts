import { fileURLToPath } from 'node:url';

import type { NextConfig } from 'next';

import { loadWebConfig } from './config.ts';

// The Rush workspace keeps packages in common/temp/node_modules. Next.js must see the whole repo
// as its file root, or it cannot find `next` through the pnpm symlinks.
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const config = loadWebConfig();

const nextConfig: NextConfig = {
  // A static site: `next build` writes plain files to out/ (or to config.outDir). No server runs,
  // so there is no proxy.ts and no middleware. The security headers come from the _headers file
  // that scripts/headers.ts writes into the export.
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  poweredByHeader: false,
  reactStrictMode: true,
  outputFileTracingRoot: REPO_ROOT,
  // With `output: 'export'`, a custom distDir names the export folder. The build files stay in .next.
  ...(config.outDir === undefined ? {} : { distDir: config.outDir }),
  turbopack: { root: REPO_ROOT },
};

export default nextConfig;
