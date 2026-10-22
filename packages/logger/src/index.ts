export { createLogger, getTraceLogFields } from './logger.js';
export type { CreateLoggerOptions, LogLevel, Logger } from './logger.js';
export {
  REDACT_PATHS,
  REDACTED_KEYS,
  REDACTED_TEXT,
  buildRedactPaths,
  isRedactedKey,
  keyVariants,
  redactRecord,
  redactValue,
} from './redact.js';
