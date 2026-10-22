import { NextResponse } from 'next/server';

import { loadWebConfig } from './config';
import { buildSecurityHeaders } from './security-headers';

/**
 * Adds the security headers to each response. It runs for each request, so the CSP `connect-src`
 * always holds the API URL and the traces URL of the running server (not those of the build).
 *
 * @returns The response with the headers.
 */
export function proxy(): NextResponse {
  const response = NextResponse.next();
  const settings = loadWebConfig();
  for (const { key, value } of buildSecurityHeaders({
    config: settings,
    isDevelopment: settings.isDevelopment,
  })) {
    response.headers.set(key, value);
  }
  return response;
}

export const config = { matcher: '/:path*' };
