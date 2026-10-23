import { describe, expect, it } from 'vitest';

import { loadConfig, SERVICE_NAME } from '../../src/api/config.js';

describe('loadConfig', () => {
  it('uses defaults for an empty environment', () => {
    expect(loadConfig({})).toEqual({
      serviceName: SERVICE_NAME,
      serviceVersion: '0.0.0',
      environment: 'local',
      host: '127.0.0.1',
      port: 3000,
      logLevel: 'info',
      corsOrigins: [],
    });
  });

  it('reads values and splits the CORS origins', () => {
    const config = loadConfig({
      SAMPLE_API_PORT: '4310',
      SAMPLE_API_HOST: '0.0.0.0',
      SAMPLE_API_LOG_LEVEL: 'debug',
      SAMPLE_API_ENVIRONMENT: 'dev',
      SAMPLE_API_VERSION: '1.2.3',
      SAMPLE_API_CORS_ORIGINS: 'http://a.test, http://b.test,,',
    });
    expect(config).toMatchObject({
      port: 4310,
      host: '0.0.0.0',
      logLevel: 'debug',
      environment: 'dev',
      serviceVersion: '1.2.3',
      corsOrigins: ['http://a.test', 'http://b.test'],
    });
  });

  it('reads the process environment by default', () => {
    expect(loadConfig().serviceName).toBe(SERVICE_NAME);
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ SAMPLE_API_PORT: '70000' })).toThrow();
  });

  it('rejects an invalid log level', () => {
    expect(() => loadConfig({ SAMPLE_API_LOG_LEVEL: 'loud' })).toThrow();
  });
});
