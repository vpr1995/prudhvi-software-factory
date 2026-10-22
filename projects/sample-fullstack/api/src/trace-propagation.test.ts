import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initTelemetry } from '@vprprudhvi/shared-telemetry';
import type { TelemetryHandle } from '@vprprudhvi/shared-telemetry';

import { makeCollectingLogger, makeTestConfig } from '../test/support.js';

import { buildServer } from './server.js';

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
const PARENT_SPAN_ID = '00f067aa0ba902b7';
const INCOMING = `00-${TRACE_ID}-${PARENT_SPAN_ID}-01`;
const TRACEPARENT_PATTERN = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;

let telemetry: TelemetryHandle;

beforeAll(() => {
  telemetry = initTelemetry({ serviceName: 'test', serviceVersion: '0.0.0', environment: 'test' });
});

afterAll(async () => {
  await telemetry.shutdown();
});

describe('trace propagation', () => {
  it('continues an incoming traceparent in the response header and in the log line', async () => {
    const { logger, lines } = makeCollectingLogger();
    const app = await buildServer({ config: makeTestConfig(), logger });
    const response = await app.inject({
      method: 'GET',
      url: '/v1/notes',
      headers: { traceparent: INCOMING },
    });
    await app.close();

    const echoed = TRACEPARENT_PATTERN.exec(String(response.headers['traceparent']));
    expect(echoed?.[1]).toBe(TRACE_ID);
    expect(echoed?.[2]).not.toBe(PARENT_SPAN_ID);

    const handlerLine = lines().find((line) => line['msg'] === 'notes listed');
    expect(handlerLine?.['trace_id']).toBe(TRACE_ID);
  });

  it('starts a new trace when no traceparent comes in', async () => {
    const { logger } = makeCollectingLogger();
    const app = await buildServer({ config: makeTestConfig(), logger });
    const response = await app.inject({ method: 'GET', url: '/v1/health' });
    await app.close();
    const echoed = TRACEPARENT_PATTERN.exec(String(response.headers['traceparent']));
    expect(echoed?.[1]).toMatch(/^[0-9a-f]{32}$/);
    expect(echoed?.[1]).not.toBe(TRACE_ID);
  });

  it('uses the trace id as requestId in the error envelope', async () => {
    const { logger } = makeCollectingLogger();
    const app = await buildServer({ config: makeTestConfig(), logger });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/notes',
      headers: { traceparent: INCOMING },
      payload: { title: '' },
    });
    await app.close();
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { requestId: string } }>().error.requestId).toBe(TRACE_ID);
  });

  it('uses the trace id as requestId for an unknown route', async () => {
    const { logger } = makeCollectingLogger();
    const app = await buildServer({ config: makeTestConfig(), logger });
    const response = await app.inject({
      method: 'GET',
      url: '/nothing',
      headers: { traceparent: INCOMING },
    });
    await app.close();
    expect(response.json<{ error: { requestId: string } }>().error.requestId).toBe(TRACE_ID);
  });
});
