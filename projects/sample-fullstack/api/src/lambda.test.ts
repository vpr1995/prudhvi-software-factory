import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { handler as LambdaHandler } from './lambda.js';

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
      vi.doUnmock('@vprprudhvi/shared-telemetry');
      vi.resetModules();
    });

    /** Loads the handler with a telemetry handle whose forceFlush is a spy. */
    async function loadHandlerWithSpy(): Promise<{
      handler: typeof LambdaHandler;
      forceFlush: ReturnType<typeof vi.fn>;
    }> {
      const forceFlush = vi.fn(() => Promise.resolve());
      vi.resetModules();
      vi.doMock('@vprprudhvi/shared-telemetry', async () => ({
        ...(await vi.importActual<Record<string, unknown>>('@vprprudhvi/shared-telemetry')),
        initTelemetry: () => ({ forceFlush, shutdown: () => Promise.resolve() }),
      }));
      const { handler } = await import('./lambda.js');
      return { handler, forceFlush };
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
  });
});
