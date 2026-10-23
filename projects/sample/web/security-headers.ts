import type { WebConfig } from './config';

/** One HTTP response header. The shape matches the headers of a Next.js response. */
export type HeaderEntry = { readonly key: string; readonly value: string };

/** What the headers depend on. */
export type SecurityHeaderOptions = {
  /** The web settings. They give the API origin and the optional browser traces URL. */
  readonly config: Pick<WebConfig, 'apiBaseUrl' | 'browserTracesUrl'>;
  /** `true` for `next dev`. Dev needs `eval` for React refresh, and HSTS is off. */
  readonly isDevelopment: boolean;
};

const ONE_YEAR_SECONDS = 31_536_000;

/**
 * Reads the origin of a URL.
 *
 * @param url - A URL, or undefined.
 * @returns The origin (`https://host:port`), or undefined when there is no URL.
 */
function originOf(url: string | undefined): string | undefined {
  return url === undefined ? undefined : new URL(url).origin;
}

/**
 * Builds the Content-Security-Policy. Next.js writes small inline scripts into each page, so
 * `script-src` keeps `'unsafe-inline'`. Everything else is closed: only the page origin, the API
 * origin and the traces origin can be called, nothing can frame the page, and no plugin can load.
 *
 * @param options - The settings and the mode.
 * @returns The policy text.
 */
export function buildContentSecurityPolicy(options: SecurityHeaderOptions): string {
  const connectSources = [
    "'self'",
    originOf(options.config.apiBaseUrl),
    originOf(options.config.browserTracesUrl),
  ].filter((source): source is string => source !== undefined);
  const scriptSources = [
    "'self'",
    "'unsafe-inline'",
    ...(options.isDevelopment ? ["'unsafe-eval'"] : []),
  ];
  const directives: Record<string, readonly string[]> = {
    'default-src': ["'self'"],
    'script-src': scriptSources,
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'"],
    'connect-src': [...new Set(connectSources)],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.join(' ')}`)
    .join('; ');
}

/**
 * Builds the security headers for every route of the web app.
 *
 * @param options - The settings and the mode.
 * @returns The header list.
 */
export function buildSecurityHeaders(options: SecurityHeaderOptions): HeaderEntry[] {
  const headers: HeaderEntry[] = [
    { key: 'Content-Security-Policy', value: buildContentSecurityPolicy(options) },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  ];
  if (!options.isDevelopment) {
    headers.push({
      key: 'Strict-Transport-Security',
      value: `max-age=${String(ONE_YEAR_SECONDS)}; includeSubDomains`,
    });
  }
  return headers;
}
