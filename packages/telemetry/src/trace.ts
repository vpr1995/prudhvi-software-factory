import { context, propagation, trace, SpanStatusCode } from '@opentelemetry/api';
import type { Attributes, Span } from '@opentelemetry/api';

const TRACER_NAME = '@vprprudhvi/shared-telemetry';
const HEX_RADIX = 16;
const TRACE_FLAGS_WIDTH = 2;
const TRACEPARENT_VERSION = '00';

/** The ids of the active span. All values are lower-case hex strings. */
export type TraceContext = {
  /** 32 hex characters. */
  readonly traceId: string;
  /** 16 hex characters. */
  readonly spanId: string;
  /** 2 hex characters. `01` means sampled. */
  readonly traceFlags: string;
};

/**
 * Reads the ids of the active span.
 *
 * @returns The trace context, or `undefined` outside a span.
 */
export function getTraceContext(): TraceContext | undefined {
  const spanContext = trace.getActiveSpan()?.spanContext();
  if (spanContext === undefined || !trace.isSpanContextValid(spanContext)) {
    return undefined;
  }
  return {
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
    traceFlags: spanContext.traceFlags.toString(HEX_RADIX).padStart(TRACE_FLAGS_WIDTH, '0'),
  };
}

/**
 * Formats a trace context as a W3C `traceparent` header value.
 *
 * @param traceContext - The ids to format.
 * @returns The header value, for example `00-<trace id>-<span id>-01`.
 */
export function formatTraceparent(traceContext: TraceContext): string {
  const { traceId, spanId, traceFlags } = traceContext;
  return `${TRACEPARENT_VERSION}-${traceId}-${spanId}-${traceFlags}`;
}

/**
 * Builds the propagation headers (`traceparent`, `tracestate`, `baggage`) for the active context.
 * Add them to an outgoing request so the next service continues the trace.
 *
 * @returns Header names and values. The object is empty outside a span.
 */
export function getTraceHeaders(): Readonly<Record<string, string>> {
  const headers: Record<string, string> = {};
  propagation.inject(context.active(), headers);
  return headers;
}

/**
 * Runs a function in a new span. The span ends when the function settles.
 * A thrown error is recorded on the span, the span status is set to error, and the error is thrown again.
 *
 * @param name - The span name, for example `orders.export`. Never put an id value in it.
 * @param run - The work to run. It receives the span.
 * @param attributes - Span attributes. Use snake_case keys. Never put secrets or personal data in them.
 * @returns The value of `run`.
 */
export async function withSpan<TResult>(
  name: string,
  run: (span: Span) => Promise<TResult> | TResult,
  attributes?: Attributes,
): Promise<TResult> {
  const tracer = trace.getTracer(TRACER_NAME);
  const spanOptions = attributes === undefined ? {} : { attributes };
  return tracer.startActiveSpan<(span: Span) => Promise<TResult>>(
    name,
    spanOptions,
    async (span) => {
      try {
        return await run(span);
      } catch (error: unknown) {
        recordSpanError(span, error);
        throw error;
      } finally {
        span.end();
      }
    },
  );
}

/**
 * Records an error on a span and sets the span status to error.
 *
 * @param span - The span to update.
 * @param error - The error to record.
 */
export function recordSpanError(span: Span, error: unknown): void {
  const exception = error instanceof Error ? error : new Error(String(error));
  span.recordException(exception);
  span.setStatus({ code: SpanStatusCode.ERROR, message: exception.message });
}
