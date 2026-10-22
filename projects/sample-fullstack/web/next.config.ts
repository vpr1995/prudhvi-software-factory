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
  // Load the OpenTelemetry Node SDK from node_modules at run time. Do not bundle it.
  serverExternalPackages: ['@vprprudhvi/shared-telemetry'],
  // The security headers come from src/proxy.ts. They are set for each request, so they use the
  // environment of the running server.
};

export default nextConfig;
