import type { Attributes } from '@opentelemetry/api';
import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  BatchSpanProcessor,
  NoopSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace';

import { loadTelemetryConfig } from './config.js';
import type { TelemetryConfig } from './config.js';

/** Settings for `initTelemetry`. */
export type TelemetryOptions = {
  /** The service name, for example `sample-fullstack-api`. It becomes `service.name`. */
  readonly serviceName: string;
  /** The service version. It becomes `service.version`. */
  readonly serviceVersion: string;
  /** The deployment environment (`local`, `prod`). It becomes `deployment.environment`. */
  readonly environment: string;
};

/** The running telemetry SDK. */
export type TelemetryHandle = {
  /**
   * Sends the spans that are waiting in the batch processor, and keeps the SDK running. Call it at
   * the end of each Lambda invocation: the runtime freezes the process after the response, so a
   * batch that waits for its timer would be lost or sent late.
   */
  readonly forceFlush: () => Promise<void>;
  /** Flushes pending spans and stops the SDK. A later `initTelemetry` call starts a new SDK. */
  readonly shutdown: () => Promise<void>;
};

let current: TelemetryHandle | undefined;

/**
 * Builds the resource attributes of a service.
 *
 * @param options - The service identity.
 * @param config - The telemetry settings. They tell whether the code runs in Lambda.
 * @returns The attributes `service.name`, `service.version`, `deployment.environment`, and `cloud.*` in Lambda.
 */
export function buildResourceAttributes(
  options: TelemetryOptions,
  config: TelemetryConfig,
): Attributes {
  const attributes: Attributes = {
    'service.name': options.serviceName,
    'service.version': options.serviceVersion,
    'deployment.environment': options.environment,
  };
  if (config.lambdaFunctionName !== undefined) {
    attributes['cloud.provider'] = 'aws';
    attributes['cloud.platform'] = 'aws_lambda';
    attributes['faas.name'] = config.lambdaFunctionName;
  }
  if (config.awsRegion !== undefined) {
    attributes['cloud.region'] = config.awsRegion;
  }
  return attributes;
}

/**
 * Starts OpenTelemetry for a Node process. Call it once, at process start.
 *
 * - Propagators: W3C `tracecontext` and `baggage`.
 * - Sampler: parent-based, with a ratio sampler for root spans (see `loadTelemetryConfig`).
 * - Exporter: OTLP over HTTP, only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set. Without it, spans are
 *   created (so trace ids exist) but not exported.
 *
 * A second call returns the running handle.
 *
 * @param options - The service identity.
 * @returns A handle to stop the SDK.
 */
export function initTelemetry(options: TelemetryOptions): TelemetryHandle {
  if (current !== undefined) {
    return current;
  }
  const config = loadTelemetryConfig(options.environment);
  const processor = config.isExportEnabled
    ? new BatchSpanProcessor({ exporter: new OTLPTraceExporter() })
    : new NoopSpanProcessor();
  const sdk = new NodeSDK({
    resource: resourceFromAttributes(buildResourceAttributes(options, config)),
    sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(config.sampleRatio) }),
    textMapPropagator: new CompositePropagator({
      propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
    }),
    // The SDK registers a tracer provider only when it has a span processor, so a no-op one keeps
    // trace ids working when export is off. Metrics and logs stay off (the SDK would default to OTLP).
    spanProcessors: [processor],
    metricReaders: [],
    logRecordProcessors: [],
  });
  sdk.start();

  const handle: TelemetryHandle = {
    forceFlush: () => processor.forceFlush(),
    shutdown: async () => {
      current = undefined;
      await sdk.shutdown();
    },
  };
  current = handle;
  return handle;
}
