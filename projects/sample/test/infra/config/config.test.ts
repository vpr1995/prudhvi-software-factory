import { describe, expect, it, vi } from 'vitest';

import {
  SAMPLE_REGION,
  loadSampleConfig,
  readSampleEnvironment,
} from '../../../lib/config/config.js';

describe('loadSampleConfig', () => {
  it.each(['local', 'prod'])('loads the %s config', (env) => {
    expect(loadSampleConfig(env)).toMatchObject({ env });
  });

  it.each([undefined, '', 'test', 'Local', 'dev', 'staging', 42])(
    'rejects the environment %s',
    (value) => {
      expect(() => loadSampleConfig(value)).toThrow(/-c env=local" or "-c env=prod/);
    },
  );

  it.each(['local', 'prod'])('gives %s at least one callback URL', (env) => {
    expect(loadSampleConfig(env).callbackUrls.length).toBeGreaterThan(0);
  });

  it('sends local sign-ins to localhost and deploys no API in local', () => {
    const config = loadSampleConfig('local');

    expect(config.callbackUrls.every((url) => url.startsWith('http://localhost:'))).toBe(true);
    expect(config.logoutUrls).toEqual(['http://localhost:3000']);
    expect(config.deployApis).toBe(false);
    expect(config.corsOrigins).toEqual([]);
  });

  it.each(['prod'])('allows only https URLs and no localhost in %s', (env) => {
    const config = loadSampleConfig(env);

    for (const url of [...config.callbackUrls, ...config.logoutUrls, ...config.corsOrigins]) {
      expect(url).toMatch(/^https:\/\//);
      expect(url).not.toContain('localhost');
    }
  });

  it.each(['local', 'prod'])('reads the prod platform parameters in %s', (env) => {
    expect(loadSampleConfig(env).platformEnv).toBe('prod');
  });

  it('deploys the APIs in prod', () => {
    expect(loadSampleConfig('prod').deployApis).toBe(true);
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
