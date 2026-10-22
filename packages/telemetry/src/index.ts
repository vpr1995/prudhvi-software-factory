export { context, propagation, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
export type { Attributes, Span } from '@opentelemetry/api';
export {
  DEFAULT_SAMPLE_RATIO,
  PROD_SAMPLE_RATIO,
  defaultSampleRatio,
  loadTelemetryConfig,
} from './config.js';
export type { TelemetryConfig } from './config.js';
export { buildResourceAttributes, initTelemetry } from './node.js';
export type { TelemetryHandle, TelemetryOptions } from './node.js';
export {
  formatTraceparent,
  getTraceContext,
  getTraceHeaders,
  recordSpanError,
  withSpan,
} from './trace.js';
export type { TraceContext } from './trace.js';
