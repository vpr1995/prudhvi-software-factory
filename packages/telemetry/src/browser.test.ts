// @vitest-environment jsdom
import type * as SdkTrace from '@opentelemetry/sdk-trace';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { initBrowserTelemetry } from './browser.js';

const API_ORIGIN = 'http://api.test';
const TRACEPARENT_PATTERN = /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/;

describe('browser sample ratio', () => {
  afterEach(() => {
    vi.doUnmock('@opentelemetry/sdk-trace');
    vi.resetModules();
  });

  /** Starts browser telemetry in a fresh module and returns the ratio that the root sampler got. */
  async function ratioFor(environment: string, sampleRatio?: number): Promise<number | undefined> {
    const ratios: number[] = [];
    vi.resetModules();
    vi.doMock('@opentelemetry/sdk-trace', async () => {
      const actual = await vi.importActual<typeof SdkTrace>('@opentelemetry/sdk-trace');
      class RecordingSampler extends actual.TraceIdRatioBasedSampler {
        public constructor(ratio: number) {
          super(ratio);
          ratios.push(ratio);
        }
      }
      return { ...actual, TraceIdRatioBasedSampler: RecordingSampler };
    });
    const { initBrowserTelemetry: init } = await import('./browser.js');
    init({
      serviceName: 'web-browser',
      serviceVersion: '0.0.0',
      environment,
      propagateTraceHeaderOrigins: [],
      ...(sampleRatio === undefined ? {} : { sampleRatio }),
    });
    return ratios[0];
  }

  it('keeps every trace outside prod', async () => {
    expect(await ratioFor('dev')).toBe(1);
  });

  it('keeps one trace in ten in prod', async () => {
    expect(await ratioFor('prod')).toBe(0.1);
  });

  it('lets an explicit ratio win', async () => {
    expect(await ratioFor('prod', 0.5)).toBe(0.5);
  });
});

describe('initBrowserTelemetry', () => {
  it('adds traceparent for listed origins only, and is idempotent', async () => {
    const received: { url: string; headers: Headers }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        received.push({ url, headers: new Headers(init?.headers) });
        return Promise.resolve(new Response('{}', { status: 200 }));
      }),
    );

    const options = {
      serviceName: 'web-browser',
      serviceVersion: '0.0.0',
      environment: 'test',
      propagateTraceHeaderOrigins: [API_ORIGIN],
    };
    const telemetry = initBrowserTelemetry(options);
    expect(initBrowserTelemetry(options)).toBe(telemetry);

    await telemetry.fetch(`${API_ORIGIN}/v1/notes`);
    await telemetry.fetch('http://other.test/v1/notes', { method: 'post' });
    await telemetry.fetch(new Request(`${API_ORIGIN}/v1/health`, { headers: { 'x-test': '1' } }));
    await telemetry.fetch('/relative');

    const [listed, other, requestInput, relative] = received;
    expect(listed?.headers.get('traceparent')).toMatch(TRACEPARENT_PATTERN);
    expect(other?.headers.has('traceparent')).toBe(false);
    expect(requestInput?.headers.get('traceparent')).toMatch(TRACEPARENT_PATTERN);
    expect(requestInput?.headers.get('x-test')).toBe('1');
    expect(relative?.headers.has('traceparent')).toBe(false);
  });

  it('keeps the span error path: a failed fetch is thrown again', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('network down')));
    const telemetry = initBrowserTelemetry({
      serviceName: 'web-browser',
      serviceVersion: '0.0.0',
      environment: 'test',
      propagateTraceHeaderOrigins: [],
    });

    await expect(telemetry.fetch(`${API_ORIGIN}/v1/notes`)).rejects.toThrow('network down');
  });

  it('marks server errors on the span and returns the response', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('{}', { status: 503 })));
    const telemetry = initBrowserTelemetry({
      serviceName: 'web-browser',
      serviceVersion: '0.0.0',
      environment: 'test',
      propagateTraceHeaderOrigins: [],
    });

    const response = await telemetry.fetch(`${API_ORIGIN}/v1/notes`);
    expect(response.status).toBe(503);
  });
});
