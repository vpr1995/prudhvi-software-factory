import { describe, expect, it } from 'vitest';

import {
  allPlatformParameterNames,
  DEPLOY_ENVS,
  isDeployEnv,
  isPlatformEnv,
  PLATFORM_ENVS,
  platformParameterName,
  platformParameterNames,
  PLATFORM_WRITTEN_KEYS,
  writtenPlatformParameterNames,
} from '../src/platform-parameters.js';

describe('platformParameterNames', () => {
  it('returns the exact names of ADR 0006 for prod', () => {
    expect(platformParameterNames('prod')).toEqual({
      userPoolId: '/platform/prod/cognito/user-pool-id',
      userPoolArn: '/platform/prod/cognito/user-pool-arn',
      userPoolDomain: '/platform/prod/cognito/user-pool-domain',
      hostedZoneId: '/platform/prod/dns/hosted-zone-id',
      zoneName: '/platform/prod/dns/zone-name',
      wildcardCertificateArn: '/platform/prod/acm/wildcard-certificate-arn',
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
  it('lists exactly the six contract names for prod', () => {
    expect(allPlatformParameterNames('prod')).toEqual([
      '/platform/prod/cognito/user-pool-id',
      '/platform/prod/cognito/user-pool-arn',
      '/platform/prod/cognito/user-pool-domain',
      '/platform/prod/dns/hosted-zone-id',
      '/platform/prod/dns/zone-name',
      '/platform/prod/acm/wildcard-certificate-arn',
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
    for (const name of writtenPlatformParameterNames('prod')) {
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
  it.each(['prod'])('accepts %s', (value) => {
    expect(isPlatformEnv(value)).toBe(true);
  });

  it.each(['', 'Prod', 'production', 'test', 'local', 'dev', 'staging'])(
    'rejects "%s"',
    (value) => {
      expect(isPlatformEnv(value)).toBe(false);
    },
  );

  it('lists only prod, because the platform deploys only prod', () => {
    expect(PLATFORM_ENVS).toEqual(['prod']);
  });
});

describe('isDeployEnv', () => {
  it.each(['local', 'prod'])('accepts %s', (value) => {
    expect(isDeployEnv(value)).toBe(true);
  });

  it.each(['', 'Local', 'production', 'test', 'dev', 'staging'])('rejects "%s"', (value) => {
    expect(isDeployEnv(value)).toBe(false);
  });

  it('lists local and prod, and every platform environment is a deploy environment', () => {
    expect(DEPLOY_ENVS).toEqual(['local', 'prod']);
    for (const env of PLATFORM_ENVS) {
      expect(isDeployEnv(env)).toBe(true);
    }
  });
});
