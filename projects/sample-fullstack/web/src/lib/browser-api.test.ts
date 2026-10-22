import { describe, expect, it, vi } from 'vitest';

import { createBrowserApiClient } from './browser-api';

const TRACEPARENT_PATTERN = /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;
const NOTE = {
  id: '3f1b9a52-7d0e-4c1a-9b53-2a6f0e5d8c11',
  title: 'Plan',
  body: '',
  createdAt: '2026-01-02T03:04:05.000Z',
};

describe('createBrowserApiClient', () => {
  it('sends traceparent to the API origin', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(Response.json(NOTE, { status: 201 })));
    vi.stubGlobal('fetch', fetchMock);

    const result = await createBrowserApiClient({
      apiBaseUrl: 'http://api.test',
      serviceVersion: '0.0.0',
      environment: 'test',
    }).createNote({ title: 'Plan' });

    expect(result).toEqual({ ok: true, value: NOTE });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('http://api.test/v1/notes');
    expect(new Headers(init?.headers).get('traceparent')).toMatch(TRACEPARENT_PATTERN);
  });

  it('passes the traces URL to the browser telemetry only when it is set', async () => {
    vi.resetModules();
    const init = vi.fn((_options: Record<string, unknown>) => ({ fetch: globalThis.fetch }));
    vi.doMock('@vprprudhvi/shared-telemetry/browser', () => ({ initBrowserTelemetry: init }));
    const { createBrowserApiClient: create } = await import('./browser-api');

    create({ apiBaseUrl: 'http://api.test', serviceVersion: '0', environment: 'prod' });
    create({
      apiBaseUrl: 'http://api.test',
      serviceVersion: '0',
      environment: 'prod',
      tracesUrl: 'http://otel.test/v1/traces',
    });

    expect(init.mock.calls[0]?.[0]).not.toHaveProperty('tracesUrl');
    expect(init.mock.calls[1]?.[0]).toMatchObject({
      tracesUrl: 'http://otel.test/v1/traces',
      environment: 'prod',
    });
    vi.doUnmock('@vprprudhvi/shared-telemetry/browser');
  });
});
