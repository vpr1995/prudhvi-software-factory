import { context, propagation, SpanKind, trace } from '@opentelemetry/api';
import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
  TracerProvider,
} from '@opentelemetry/sdk-trace';

import { defaultSampleRatio } from './config.js';
import { recordSpanError } from './trace.js';

const TRACER_NAME = '@vprprudhvi/shared-telemetry/browser';
const FIRST_SERVER_ERROR_STATUS = 500;

/** The input of `fetch`. */
type FetchInput = string | URL | Request;

/** Settings for `initBrowserTelemetry`. */
export type BrowserTelemetryOptions = {
  /** The service name, for example `sample-fullstack-web-browser`. */
  readonly serviceName: string;
  /** The service version. */
  readonly serviceVersion: string;
  /** The deployment environment. */
  readonly environment: string;
  /** Origins that receive the trace headers, for example `https://api.example.com`. Use the API origin only. */
  readonly propagateTraceHeaderOrigins: readonly string[];
  /** The OTLP/HTTP traces URL. When unset, spans are created but not exported. */
  readonly tracesUrl?: string;
  /** Share of root traces to keep, from 0 to 1. Defaults by environment: 0.1 in prod, 1 otherwise. */
  readonly sampleRatio?: number;
};

/** The browser telemetry that `initBrowserTelemetry` starts. */
export type BrowserTelemetry = {
  /**
   * A `fetch` that makes a client span for each call. For a URL on a listed origin it adds
   * `traceparent` (and `tracestate` and `baggage`), so the server continues the trace.
   */
  readonly fetch: (input: FetchInput, init?: RequestInit) => Promise<Response>;
};

let current: BrowserTelemetry | undefined;

/**
 * Reads the URL of a fetch input.
 *
 * @param input - The first argument of `fetch`.
 * @returns The parsed URL.
 */
function toUrl(input: FetchInput): URL {
  if (input instanceof Request) {
    return new URL(input.url);
  }
  return new URL(input, globalThis.location.href);
}

/**
 * Creates the traced `fetch`.
 *
 * @param origins - Origins that receive the trace headers.
 * @returns A function with the signature of `fetch`.
 */
function createTracedFetch(origins: ReadonlySet<string>): BrowserTelemetry['fetch'] {
  return async (input, init) => {
    const url = toUrl(input);
    const method = (
      init?.method ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();
    const span = trace.getTracer(TRACER_NAME).startSpan(`HTTP ${method}`, {
      kind: SpanKind.CLIENT,
      attributes: { 'http.request.method': method, 'server.address': url.hostname },
    });
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    if (origins.has(url.origin)) {
      propagation.inject(trace.setSpan(context.active(), span), headers, {
        set: (carrier, key, value) => {
          carrier.set(key, value);
        },
      });
    }
    try {
      const response = await globalThis.fetch(input, { ...init, headers });
      span.setAttribute('http.response.status_code', response.status);
      if (response.status >= FIRST_SERVER_ERROR_STATUS) {
        recordSpanError(span, new Error(`HTTP ${String(response.status)}`));
      }
      return response;
    } catch (error: unknown) {
      recordSpanError(span, error);
      throw error;
    } finally {
      span.end();
    }
  };
}

/**
 * Starts browser tracing. Call it once, in client code, after the page loads. A second call returns
 * the first result.
 *
 * Browser code has no async context, so use the returned `fetch` for each call to the API.
 *
 * @param options - The service identity and the origins that receive trace headers.
 * @returns The traced `fetch`.
 */
export function initBrowserTelemetry(options: BrowserTelemetryOptions): BrowserTelemetry {
  if (current !== undefined) {
    return current;
  }
  const provider = new TracerProvider({
    resource: resourceFromAttributes({
      'service.name': options.serviceName,
      'service.version': options.serviceVersion,
      'deployment.environment': options.environment,
    }),
    sampler: new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(
        options.sampleRatio ?? defaultSampleRatio(options.environment),
      ),
    }),
    spanProcessors:
      options.tracesUrl === undefined
        ? []
        : [new BatchSpanProcessor({ exporter: new OTLPTraceExporter({ url: options.tracesUrl }) })],
  });
  trace.setGlobalTracerProvider(provider);
  propagation.setGlobalPropagator(
    new CompositePropagator({
      propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
    }),
  );

  const origins = new Set(
    options.propagateTraceHeaderOrigins.map((origin) => new URL(origin).origin),
  );
  current = { fetch: createTracedFetch(origins) };
  return current;
}
