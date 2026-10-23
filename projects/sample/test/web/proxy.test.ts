// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { config, proxy } from '../../web/proxy';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('proxy', () => {
  it('sets the security headers, with the API URL of the running server in connect-src', () => {
    vi.stubEnv('SAMPLE_WEB_API_URL', 'https://api.runtime.test');

    const response = proxy();

    expect(response.headers.get('content-security-policy')).toContain(
      "connect-src 'self' https://api.runtime.test;",
    );
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('strict-transport-security')).toContain('max-age=');
  });

  it('reads the environment on each call, not once', () => {
    vi.stubEnv('SAMPLE_WEB_API_URL', 'https://first.test');
    const first = proxy().headers.get('content-security-policy');
    vi.stubEnv('SAMPLE_WEB_API_URL', 'https://second.test');
    const second = proxy().headers.get('content-security-policy');

    expect(first).toContain('https://first.test');
    expect(second).toContain('https://second.test');
    expect(second).not.toContain('https://first.test');
  });

  it('allows eval and skips HSTS in development', () => {
    vi.stubEnv('NODE_ENV', 'development');

    const response = proxy();

    expect(response.headers.get('content-security-policy')).toContain("'unsafe-eval'");
    expect(response.headers.get('strict-transport-security')).toBeNull();
  });

  it('runs for every path', () => {
    expect(config.matcher).toBe('/:path*');
  });
});
