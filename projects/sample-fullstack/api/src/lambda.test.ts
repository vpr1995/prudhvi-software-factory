import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as SharedLogger from '@vprprudhvi/shared-logger';

import { FLUSH_TIMEOUT_MS, type handler as LambdaHandler } from './lambda.js';

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
const INCOMING = `00-${TRACE_ID}-00f067aa0ba902b7-01`;

function makeEvent(
  method: string,
  path: string,
  headers: Record<string, string>,
): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: '$default',
    rawPath: path,
    rawQueryString: '',
    headers,
    requestContext: {
      accountId: '123456789012',
      apiId: 'api',
      domainName: 'api.example.test',
      domainPrefix: 'api',
      http: { method, path, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'vitest' },
      requestId: 'request-1',
      routeKey: '$default',
      stage: '$default',
      time: '02/Jan/2026:03:04:05 +0000',
      timeEpoch: 1_767_323_045_000,
    },
    isBase64Encoded: false,
  };
}

// The handler reads none of the deprecated callbacks, so the fixture leaves them out.
const CONTEXT = {
  callbackWaitsForEmptyEventLoop: false,
  functionName: 'sample-fullstack-api',
  functionVersion: '$LATEST',
  invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:sample-fullstack-api',
  memoryLimitInMB: '256',
  awsRequestId: 'request-1',
  logGroupName: '/aws/lambda/sample-fullstack-api',
  logStreamName: 'stream',
  getRemainingTimeInMillis: () => 1000,
} as Context;

describe('Lambda handler', () => {
  it('answers an API Gateway HTTP API event and continues the trace', async () => {
    const { handler } = await import('./lambda.js');
    const response = await handler(
      makeEvent('GET', '/v1/health', { traceparent: INCOMING }),
      CONTEXT,
    );
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ status: 'ok' });
    expect(response.headers['traceparent']).toContain(TRACE_ID);
  });

  describe('span flush', () => {
    afterEach(() => {
      vi.useRealTimers();
      vi.doUnmock('@vprprudhvi/shared-telemetry');
      vi.doUnmock('@vprprudhvi/shared-logger');
      vi.resetModules();
    });

    /** Loads the handler with a telemetry handle whose forceFlush is a spy. */
    async function loadHandlerWithSpy(
      flush: () => Promise<void> = () => Promise.resolve(),
    ): Promise<{
      handler: typeof LambdaHandler;
      forceFlush: ReturnType<typeof vi.fn>;
      logLines: Record<string, unknown>[];
    }> {
      const forceFlush = vi.fn(flush);
      const logLines: Record<string, unknown>[] = [];
      vi.resetModules();
      vi.doMock('@vprprudhvi/shared-telemetry', async () => ({
        ...(await vi.importActual<Record<string, unknown>>('@vprprudhvi/shared-telemetry')),
        initTelemetry: () => ({ forceFlush, shutdown: () => Promise.resolve() }),
      }));
      vi.doMock('@vprprudhvi/shared-logger', async () => {
        const actual = await vi.importActual<typeof SharedLogger>('@vprprudhvi/shared-logger');
        return {
          ...actual,
          createLogger: (options: Parameters<typeof actual.createLogger>[0]) =>
            actual.createLogger({
              ...options,
              destination: {
                write: (line: string) => {
                  logLines.push(JSON.parse(line) as Record<string, unknown>);
                },
              },
            }),
        };
      });
      const { handler } = await import('./lambda.js');
      return { handler, forceFlush, logLines };
    }

    it('flushes the pending spans after each response, before Lambda freezes the process', async () => {
      const { handler, forceFlush } = await loadHandlerWithSpy();

      const response = await handler(makeEvent('GET', '/v1/health', {}), CONTEXT);

      expect(response.statusCode).toBe(200);
      expect(forceFlush).toHaveBeenCalledTimes(1);
    });

    it('flushes when the response is an error status', async () => {
      const { handler, forceFlush } = await loadHandlerWithSpy();

      const response = await handler(makeEvent('GET', '/missing', {}), CONTEXT);

      expect(response.statusCode).toBe(404);
      expect(forceFlush).toHaveBeenCalledTimes(1);
    });

    it('still returns the response and logs a warning when the flush rejects', async () => {
      const { handler, logLines } = await loadHandlerWithSpy(() =>
        Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:4318')),
      );

      const response = await handler(makeEvent('GET', '/v1/health', {}), CONTEXT);

      expect(response.statusCode).toBe(200);
      expect(logLines).toContainEqual(
        expect.objectContaining({
          level: 'warn',
          msg: 'flush spans failed',
          error: 'connect ECONNREFUSED 127.0.0.1:4318',
        }),
      );
    });

    it('returns within the flush bound and logs a warning when the flush hangs', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const { handler, forceFlush, logLines } = await loadHandlerWithSpy(
        () =>
          new Promise<void>(() => {
            // A collector that never answers: the promise never settles.
          }),
      );

      let response: Awaited<ReturnType<typeof handler>> | undefined;
      const pending = (async () => {
        response = await handler(makeEvent('GET', '/v1/health', {}), CONTEXT);
      })();
      while (forceFlush.mock.calls.length === 0) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      await vi.advanceTimersByTimeAsync(FLUSH_TIMEOUT_MS - 1);
      expect(response).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      await pending;

      expect(response?.statusCode).toBe(200);
      expect(logLines).toContainEqual(
        expect.objectContaining({ level: 'warn', msg: 'flush spans failed' }),
      );
    });
  });
});
