import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initTelemetry } from './node.js';
import type { TelemetryHandle } from './node.js';
import {
  formatTraceparent,
  getTraceContext,
  getTraceHeaders,
  recordSpanError,
  withSpan,
} from './trace.js';

import { trace } from './index.js';
import type { Span } from './index.js';

const TRACE_ID_LENGTH = 32;
const SPAN_ID_LENGTH = 16;

let handle: TelemetryHandle;

function messageOf(exception: Parameters<Span['recordException']>[0]): string {
  return typeof exception === 'string' ? exception : (exception.message ?? '');
}

beforeAll(() => {
  handle = initTelemetry({ serviceName: 'test', serviceVersion: '0.0.0', environment: 'test' });
});

afterAll(async () => {
  await handle.shutdown();
});

describe('getTraceContext', () => {
  it('returns undefined outside a span', () => {
    expect(getTraceContext()).toBeUndefined();
    expect(getTraceHeaders()).toEqual({});
  });

  it('returns ids and flags inside a span', async () => {
    const traceContext = await withSpan('test.read-context', () => getTraceContext());

    expect(traceContext?.traceId).toHaveLength(TRACE_ID_LENGTH);
    expect(traceContext?.spanId).toHaveLength(SPAN_ID_LENGTH);
    expect(traceContext?.traceFlags).toBe('01');
  });
});

describe('formatTraceparent', () => {
  it('builds a W3C traceparent value', () => {
    expect(
      formatTraceparent({
        traceId: 'a'.repeat(TRACE_ID_LENGTH),
        spanId: 'b'.repeat(SPAN_ID_LENGTH),
        traceFlags: '01',
      }),
    ).toBe(`00-${'a'.repeat(TRACE_ID_LENGTH)}-${'b'.repeat(SPAN_ID_LENGTH)}-01`);
  });
});

describe('getTraceHeaders', () => {
  it('injects traceparent for the active span', async () => {
    const result = await withSpan('test.headers', () => ({
      headers: getTraceHeaders(),
      traceContext: getTraceContext(),
    }));

    expect(result.traceContext).toBeDefined();
    expect(result.headers['traceparent']).toBe(
      formatTraceparent({ traceId: '', spanId: '', traceFlags: '', ...result.traceContext }),
    );
  });
});

describe('withSpan', () => {
  it('returns the value of the function', async () => {
    const value = await withSpan(
      'test.value',
      (span) => {
        expect(span.isRecording()).toBe(true);
        return 42;
      },
      { 'app.item_count': 3 },
    );

    expect(value).toBe(42);
  });

  it('nests spans in one trace', async () => {
    const { outer, inner } = await withSpan('test.outer', async () => {
      const outerContext = getTraceContext();
      const innerContext = await withSpan('test.inner', () => getTraceContext());
      return { outer: outerContext, inner: innerContext };
    });

    expect(inner?.traceId).toBe(outer?.traceId);
    expect(inner?.spanId).not.toBe(outer?.spanId);
  });

  it('records the error, ends the span, and throws the error again', async () => {
    const failure = new Error('boom');
    const recorded: string[] = [];
    let isEnded = false;

    await expect(
      withSpan('test.fail', (span) => {
        const endSpan = span.end.bind(span);
        span.end = () => {
          isEnded = true;
          endSpan();
        };
        const recordException = span.recordException.bind(span);
        span.recordException = (exception) => {
          recorded.push(messageOf(exception));
          recordException(exception);
        };
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(isEnded).toBe(true);
    expect(recorded).toEqual(['boom']);
  });
});

describe('recordSpanError', () => {
  it('wraps a non-Error value', () => {
    const span = trace.getTracer('test').startSpan('test.record');
    const messages: string[] = [];
    span.recordException = (exception) => {
      messages.push(messageOf(exception));
    };

    recordSpanError(span, 'plain text');
    span.end();

    expect(messages).toEqual(['plain text']);
  });
});
