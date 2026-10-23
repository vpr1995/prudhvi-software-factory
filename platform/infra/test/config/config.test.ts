import { describe, expect, it, vi } from 'vitest';

import {
  PLATFORM_REGION,
  loadPlatformConfig,
  readPlatformEnvironment,
} from '../../lib/config/config.js';

describe('loadPlatformConfig', () => {
  it.each(['dev', 'staging', 'prod'])('loads the %s config', (env) => {
    expect(loadPlatformConfig(env)).toMatchObject({ env, domainPrefix: 'vprprudhvi' });
  });

  it.each([undefined, '', 'test', 'Dev', 42])('rejects the environment %s', (value) => {
    expect(() => loadPlatformConfig(value)).toThrow(/-c env=dev/);
  });
});

describe('readPlatformEnvironment', () => {
  it('uses the account of the CDK CLI and the fixed region', () => {
    const account = '1'.repeat(12);
    vi.stubEnv('CDK_DEFAULT_ACCOUNT', account);

    expect(readPlatformEnvironment()).toEqual({ account, region: 'us-east-1' });
  });

  it.each([undefined, ''])('leaves the account unset for %j (offline synth)', (value) => {
    vi.stubEnv('CDK_DEFAULT_ACCOUNT', value);

    expect(readPlatformEnvironment()).toEqual({ region: PLATFORM_REGION });
  });
});
