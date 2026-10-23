import { describe, expect, it } from 'vitest';

import { buildContentSecurityPolicy, buildSecurityHeaders } from './security-headers';

const CONFIG = {
  apiBaseUrl: 'https://api.example.test:8443/base',
  browserTracesUrl: 'https://otel.example.test/v1/traces',
};

function directive(policy: string, name: string): string[] {
  const entry = policy.split('; ').find((item) => item.startsWith(`${name} `));
  return entry === undefined ? [] : entry.split(' ').slice(1);
}

describe('buildContentSecurityPolicy', () => {
  it('allows the page, the API origin and the traces origin in connect-src, and nothing else', () => {
    const policy = buildContentSecurityPolicy({ config: CONFIG, isDevelopment: false });

    expect(directive(policy, 'connect-src')).toEqual([
      "'self'",
      'https://api.example.test:8443',
      'https://otel.example.test',
    ]);
  });

  it('leaves out the traces origin when there is none, and does not repeat an origin', () => {
    const policy = buildContentSecurityPolicy({
      config: { apiBaseUrl: 'http://127.0.0.1:3000', browserTracesUrl: undefined },
      isDevelopment: false,
    });

    expect(directive(policy, 'connect-src')).toEqual(["'self'", 'http://127.0.0.1:3000']);
    const same = buildContentSecurityPolicy({
      config: { apiBaseUrl: 'http://a.test', browserTracesUrl: 'http://a.test/v1/traces' },
      isDevelopment: false,
    });
    expect(directive(same, 'connect-src')).toEqual(["'self'", 'http://a.test']);
  });

  it('keeps inline scripts for Next.js, forbids framing and plugins, and allows eval only in dev', () => {
    const production = buildContentSecurityPolicy({ config: CONFIG, isDevelopment: false });
    const development = buildContentSecurityPolicy({ config: CONFIG, isDevelopment: true });

    expect(directive(production, 'script-src')).toEqual(["'self'", "'unsafe-inline'"]);
    expect(directive(development, 'script-src')).toContain("'unsafe-eval'");
    expect(directive(production, 'frame-ancestors')).toEqual(["'none'"]);
    expect(directive(production, 'object-src')).toEqual(["'none'"]);
    expect(directive(production, 'default-src')).toEqual(["'self'"]);
  });
});

describe('buildSecurityHeaders', () => {
  const valueOf = (headers: { key: string; value: string }[], key: string): string | undefined =>
    headers.find((header) => header.key === key)?.value;

  it('sets the standard headers, with HSTS outside development', () => {
    const headers = buildSecurityHeaders({ config: CONFIG, isDevelopment: false });

    expect(valueOf(headers, 'X-Content-Type-Options')).toBe('nosniff');
    expect(valueOf(headers, 'X-Frame-Options')).toBe('DENY');
    expect(valueOf(headers, 'Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(valueOf(headers, 'Content-Security-Policy')).toContain("frame-ancestors 'none'");
    expect(valueOf(headers, 'Strict-Transport-Security')).toContain('max-age=31536000');
  });

  it('leaves out HSTS in development', () => {
    const headers = buildSecurityHeaders({ config: CONFIG, isDevelopment: true });

    expect(valueOf(headers, 'Strict-Transport-Security')).toBeUndefined();
  });
});
