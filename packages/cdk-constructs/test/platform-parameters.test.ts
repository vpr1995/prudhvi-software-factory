import { describe, expect, it } from 'vitest';

import {
  allPlatformParameterNames,
  isPlatformEnv,
  PLATFORM_ENVS,
  platformParameterName,
  platformParameterNames,
  PLATFORM_WRITTEN_KEYS,
  writtenPlatformParameterNames,
} from '../src/platform-parameters.js';

describe('platformParameterNames', () => {
  it('returns the exact names of ADR 0006 for dev', () => {
    expect(platformParameterNames('dev')).toEqual({
      userPoolId: '/platform/dev/cognito/user-pool-id',
      userPoolArn: '/platform/dev/cognito/user-pool-arn',
      userPoolDomain: '/platform/dev/cognito/user-pool-domain',
      hostedZoneId: '/platform/dev/dns/hosted-zone-id',
      zoneName: '/platform/dev/dns/zone-name',
      wildcardCertificateArn: '/platform/dev/acm/wildcard-certificate-arn',
    });
  });

  it.each(PLATFORM_ENVS)('puts the %s environment in each name', (env) => {
    for (const name of allPlatformParameterNames(env)) {
      expect(name.startsWith(`/platform/${env}/`)).toBe(true);
    }
  });
});

describe('platformParameterName', () => {
  it('builds one name from an environment and a key', () => {
    expect(platformParameterName('prod', 'wildcardCertificateArn')).toBe(
      '/platform/prod/acm/wildcard-certificate-arn',
    );
  });
});

describe('allPlatformParameterNames', () => {
  it('lists exactly the six contract names for staging', () => {
    expect(allPlatformParameterNames('staging')).toEqual([
      '/platform/staging/cognito/user-pool-id',
      '/platform/staging/cognito/user-pool-arn',
      '/platform/staging/cognito/user-pool-domain',
      '/platform/staging/dns/hosted-zone-id',
      '/platform/staging/dns/zone-name',
      '/platform/staging/acm/wildcard-certificate-arn',
    ]);
  });

  it('has no duplicate names across all environments', () => {
    const all = PLATFORM_ENVS.flatMap((env) => allPlatformParameterNames(env));
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('writtenPlatformParameterNames', () => {
  it('lists only the three Cognito names that platform writes today', () => {
    expect(writtenPlatformParameterNames('prod')).toEqual([
      '/platform/prod/cognito/user-pool-id',
      '/platform/prod/cognito/user-pool-arn',
      '/platform/prod/cognito/user-pool-domain',
    ]);
  });

  it('holds no DNS or ACM name, because no zone and no certificate exist yet', () => {
    for (const name of writtenPlatformParameterNames('dev')) {
      expect(name).not.toMatch(/\/(dns|acm)\//);
    }
  });

  it.each(PLATFORM_ENVS)('is a part of the full contract for %s', (env) => {
    expect(allPlatformParameterNames(env)).toEqual(
      expect.arrayContaining([...writtenPlatformParameterNames(env)]),
    );
    expect(PLATFORM_WRITTEN_KEYS).toHaveLength(3);
  });
});

describe('isPlatformEnv', () => {
  it.each(['dev', 'staging', 'prod'])('accepts %s', (value) => {
    expect(isPlatformEnv(value)).toBe(true);
  });

  it.each(['', 'Dev', 'production', 'test'])('rejects "%s"', (value) => {
    expect(isPlatformEnv(value)).toBe(false);
  });
});
