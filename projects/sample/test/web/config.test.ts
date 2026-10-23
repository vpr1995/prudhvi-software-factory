import { describe, expect, it } from 'vitest';

import { isNodeRuntime, loadWebConfig } from '../../web/config';

describe('loadWebConfig', () => {
  it('uses defaults for an empty environment', () => {
    expect(loadWebConfig({})).toEqual({
      apiBaseUrl: 'http://127.0.0.1:3000',
      environment: 'local',
      serviceVersion: '0.0.0',
      isDevelopment: false,
    });
  });

  it('reads the values', () => {
    expect(
      loadWebConfig({
        SAMPLE_WEB_API_URL: 'https://api.example.test',
        SAMPLE_WEB_ENVIRONMENT: 'dev',
        SAMPLE_WEB_VERSION: '1.2.3',
      }),
    ).toEqual({
      apiBaseUrl: 'https://api.example.test',
      environment: 'dev',
      serviceVersion: '1.2.3',
      isDevelopment: false,
    });
  });

  it('reads the browser traces URL, and treats an empty value as not set', () => {
    expect(
      loadWebConfig({
        SAMPLE_WEB_BROWSER_TRACES_URL: 'https://otel.example.test/v1/traces',
      }).browserTracesUrl,
    ).toBe('https://otel.example.test/v1/traces');
    expect(loadWebConfig({ SAMPLE_WEB_BROWSER_TRACES_URL: '' }).browserTracesUrl).toBeUndefined();
    expect(loadWebConfig({}).browserTracesUrl).toBeUndefined();
  });

  it('is in development mode only when NODE_ENV is development', () => {
    expect(loadWebConfig({ NODE_ENV: 'development' }).isDevelopment).toBe(true);
    expect(loadWebConfig({ NODE_ENV: 'production' }).isDevelopment).toBe(false);
    expect(loadWebConfig({}).isDevelopment).toBe(false);
  });

  it('rejects a browser traces URL that is not a URL', () => {
    expect(() => loadWebConfig({ SAMPLE_WEB_BROWSER_TRACES_URL: 'not a url' })).toThrow();
  });

  it('reads the process environment by default', () => {
    expect(loadWebConfig().apiBaseUrl).toMatch(/^https?:\/\//);
  });

  it('rejects an API URL that is not a URL', () => {
    expect(() => loadWebConfig({ SAMPLE_WEB_API_URL: 'not a url' })).toThrow();
  });
});

describe('isNodeRuntime', () => {
  it('is false outside Next.js', () => {
    expect(isNodeRuntime).toBe(false);
  });
});
