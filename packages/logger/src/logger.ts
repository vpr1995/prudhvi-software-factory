import { pino } from 'pino';
import type { DestinationStream, Logger } from 'pino';

import { getTraceContext } from '@vprprudhvi/shared-telemetry';

import { REDACT_PATHS, REDACTED_TEXT, redactRecord } from './redact.js';

const FIELD_TRACE_ID = 'trace_id';
const FIELD_SPAN_ID = 'span_id';
const FIELD_TRACE_FLAGS = 'trace_flags';

/** A log level name. */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';

/** Settings for `createLogger`. */
export type CreateLoggerOptions = {
  /** The service name. It becomes the `service.name` field of each line. */
  readonly serviceName: string;
  /** The minimum level. Defaults to `info`. */
  readonly level?: LogLevel;
  /** Where lines go. Defaults to standard output. Tests pass a stream here. */
  readonly destination?: DestinationStream;
};

/** The logger type. Call `logger.info({ orderId }, 'order exported')`. */
export type { Logger };

/**
 * Reads the trace fields of the active span for a log line.
 *
 * @returns `trace_id`, `span_id` and `trace_flags`, or an empty object outside a span.
 */
export function getTraceLogFields(): Record<string, string> {
  const traceContext = getTraceContext();
  if (traceContext === undefined) {
    return {};
  }
  return Object.fromEntries([
    [FIELD_TRACE_ID, traceContext.traceId],
    [FIELD_SPAN_ID, traceContext.spanId],
    [FIELD_TRACE_FLAGS, traceContext.traceFlags],
  ]);
}

/**
 * Creates the JSON logger. Each line has `level` (a string), `time` (ISO 8601), `msg`, `service.name`,
 * and the trace fields of the active span. Known secret and personal data keys are redacted.
 *
 * @param options - The service name and optional level and destination.
 * @returns A pino logger.
 */
export function createLogger(options: CreateLoggerOptions): Logger {
  const { serviceName, level = 'info', destination } = options;
  const settings = {
    level,
    base: { 'service.name': serviceName },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label: string) => ({ level: label }),
      // Pino paths match one spelling of a key. This step matches any case and separator style.
      log: redactRecord,
    },
    redact: { paths: [...REDACT_PATHS], censor: REDACTED_TEXT },
    mixin: getTraceLogFields,
  };
  return destination === undefined ? pino(settings) : pino(settings, destination);
}
