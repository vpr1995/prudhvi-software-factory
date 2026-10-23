import { describe, expect, it, vi } from 'vitest';

import {
  SAMPLE_REGION,
  loadSampleConfig,
  readSampleEnvironment,
} from '../../../lib/config/config.js';

describe('loadSampleConfig', () => {
  it.each(['dev', 'staging', 'prod'])('loads the %s config', (env) => {
    expect(loadSampleConfig(env)).toMatchObject({ env });
  });

  it.each([undefined, '', 'test', 'Dev', 42])('rejects the environment %s', (value) => {
    expect(() => loadSampleConfig(value)).toThrow(/-c env=dev/);
  });

  it.each(['dev', 'staging', 'prod'])('gives %s at least one callback URL', (env) => {
    expect(loadSampleConfig(env).callbackUrls.length).toBeGreaterThan(0);
  });

  it('sends dev sign-ins and browser calls to localhost', () => {
    const config = loadSampleConfig('dev');

    expect(config.callbackUrls.every((url) => url.startsWith('http://localhost:'))).toBe(true);
    expect(config.corsOrigins).toEqual(['http://localhost:3000']);
  });

  it.each(['staging', 'prod'])('allows only https URLs and no localhost in %s', (env) => {
    const config = loadSampleConfig(env);

    for (const url of [...config.callbackUrls, ...config.logoutUrls, ...config.corsOrigins]) {
      expect(url).toMatch(/^https:\/\//);
      expect(url).not.toContain('localhost');
    }
  });
});

describe('readSampleEnvironment', () => {
  it('uses the account of the CDK CLI and the fixed region', () => {
    const account = '1'.repeat(12);
    vi.stubEnv('CDK_DEFAULT_ACCOUNT', account);

    expect(readSampleEnvironment()).toEqual({ account, region: 'us-east-1' });
  });

  it.each([undefined, ''])('leaves the account unset for %j (offline synth)', (value) => {
    vi.stubEnv('CDK_DEFAULT_ACCOUNT', value);

    expect(readSampleEnvironment()).toEqual({ region: SAMPLE_REGION });
  });
});
