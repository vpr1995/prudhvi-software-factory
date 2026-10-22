// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { initTelemetry, withSpan } from '@vprprudhvi/shared-telemetry';
import type { TelemetryHandle } from '@vprprudhvi/shared-telemetry';

import { createServerApiClient } from './server-api';

const TRACEPARENT_PATTERN = /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;

let telemetry: TelemetryHandle;

beforeAll(() => {
  telemetry = initTelemetry({ serviceName: 'test', serviceVersion: '0.0.0', environment: 'test' });
});

afterAll(async () => {
  await telemetry.shutdown();
});

describe('createServerApiClient', () => {
  it('sends traceparent of the active span to the API', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(Response.json({ notes: [] })));
    vi.stubGlobal('fetch', fetchMock);

    await withSpan('test.render', () => createServerApiClient('http://api.test').listNotes());

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(init?.headers).toMatchObject({
      traceparent: expect.stringMatching(TRACEPARENT_PATTERN) as unknown,
    });
  });

  it('sends no traceparent outside a span', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(Response.json({ notes: [] })));
    vi.stubGlobal('fetch', fetchMock);

    await createServerApiClient('http://api.test').listNotes();

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(init?.headers).not.toHaveProperty('traceparent');
  });
});
