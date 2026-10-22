import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildResourceAttributes, initTelemetry } from './node.js';

const options = { serviceName: 'svc', serviceVersion: '1.2.3', environment: 'dev' };

describe('buildResourceAttributes', () => {
  it('sets the service attributes', () => {
    expect(
      buildResourceAttributes(options, {
        isExportEnabled: false,
        sampleRatio: 1,
        lambdaFunctionName: undefined,
        awsRegion: undefined,
      }),
    ).toEqual({
      'service.name': 'svc',
      'service.version': '1.2.3',
      'deployment.environment': 'dev',
    });
  });

  it('adds cloud attributes in Lambda', () => {
    const attributes = buildResourceAttributes(options, {
      isExportEnabled: false,
      sampleRatio: 1,
      lambdaFunctionName: 'my-fn',
      awsRegion: 'eu-west-1',
    });
    expect(attributes['cloud.provider']).toBe('aws');
    expect(attributes['cloud.platform']).toBe('aws_lambda');
    expect(attributes['cloud.region']).toBe('eu-west-1');
    expect(attributes['faas.name']).toBe('my-fn');
  });
});

describe('initTelemetry', () => {
  const handles: { shutdown: () => Promise<void> }[] = [];

  afterEach(async () => {
    await Promise.all(handles.splice(0).map((handle) => handle.shutdown()));
  });

  it('is idempotent until shutdown', async () => {
    const first = initTelemetry(options);
    handles.push(first);
    expect(initTelemetry(options)).toBe(first);

    await first.shutdown();
    const second = initTelemetry(options);
    handles.push(second);
    expect(second).not.toBe(first);
  });

  it('forceFlush resolves with and without an exporter, and keeps the SDK running', async () => {
    const quiet = initTelemetry(options);
    handles.push(quiet);
    await expect(quiet.forceFlush()).resolves.toBeUndefined();
    expect(initTelemetry(options)).toBe(quiet);
    await quiet.shutdown();

    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://127.0.0.1:1');
    const exporting = initTelemetry(options);
    handles.push(exporting);
    await expect(exporting.forceFlush()).resolves.toBeUndefined();
    expect(initTelemetry(options)).toBe(exporting);
  });

  it('starts an exporter when an endpoint is set', async () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://127.0.0.1:1');
    const handle = initTelemetry(options);
    handles.push(handle);

    await expect(handle.shutdown()).resolves.toBeUndefined();
  });
});
