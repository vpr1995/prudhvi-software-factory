import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SAMPLE_RATIO,
  PROD_SAMPLE_RATIO,
  defaultSampleRatio,
  loadTelemetryConfig,
} from './config.js';

describe('defaultSampleRatio', () => {
  it('keeps 100% outside prod and 10% in prod', () => {
    expect(defaultSampleRatio('dev')).toBe(DEFAULT_SAMPLE_RATIO);
    expect(defaultSampleRatio('prod')).toBe(PROD_SAMPLE_RATIO);
  });
});

describe('loadTelemetryConfig', () => {
  it('does not export spans without an endpoint', () => {
    const config = loadTelemetryConfig('dev', {});
    expect(config.isExportEnabled).toBe(false);
    expect(config.sampleRatio).toBe(1);
    expect(config.lambdaFunctionName).toBeUndefined();
  });

  it('exports spans when an endpoint is set', () => {
    expect(
      loadTelemetryConfig('dev', { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318' })
        .isExportEnabled,
    ).toBe(true);
    expect(
      loadTelemetryConfig('dev', {
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://localhost:4318/v1/traces',
      }).isExportEnabled,
    ).toBe(true);
  });

  it('turns export off with OTEL_TRACES_EXPORTER=none', () => {
    const config = loadTelemetryConfig('dev', {
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
      OTEL_TRACES_EXPORTER: 'none',
    });
    expect(config.isExportEnabled).toBe(false);
  });

  it('reads the sample ratio and treats empty values as unset', () => {
    expect(loadTelemetryConfig('prod', {}).sampleRatio).toBe(PROD_SAMPLE_RATIO);
    expect(loadTelemetryConfig('prod', { OTEL_TRACES_SAMPLER_ARG: '0.5' }).sampleRatio).toBe(0.5);
    expect(loadTelemetryConfig('prod', { OTEL_TRACES_SAMPLER_ARG: '' }).sampleRatio).toBe(
      PROD_SAMPLE_RATIO,
    );
  });

  it('reads the Lambda settings', () => {
    const config = loadTelemetryConfig('dev', {
      AWS_LAMBDA_FUNCTION_NAME: 'fn',
      AWS_REGION: 'eu-west-1',
    });
    expect(config.lambdaFunctionName).toBe('fn');
    expect(config.awsRegion).toBe('eu-west-1');
  });

  it('rejects a ratio outside 0..1', () => {
    expect(() => loadTelemetryConfig('dev', { OTEL_TRACES_SAMPLER_ARG: '2' })).toThrow();
  });
});
