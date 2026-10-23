import { z } from 'zod';

const DEFAULT_API_URL = 'http://127.0.0.1:3000';
const DEFAULT_VERSION = '0.0.0';

/** The service name. It is the `service.name` of server traces. */
export const SERVICE_NAME = 'sample-web';

/** The service name of browser traces. */
export const BROWSER_SERVICE_NAME = 'sample-web-browser';

// An empty value counts as not set, like in the other services.
const OptionalUrlSchema = z
  .union([z.literal('').transform((): string | undefined => undefined), z.url()])
  .optional();

const EnvironmentSchema = z.object({
  SAMPLE_WEB_API_URL: z.url().default(DEFAULT_API_URL),
  SAMPLE_WEB_ENVIRONMENT: z.string().min(1).default('local'),
  SAMPLE_WEB_VERSION: z.string().min(1).default(DEFAULT_VERSION),
  SAMPLE_WEB_BROWSER_TRACES_URL: OptionalUrlSchema,
  NODE_ENV: z.string().optional(),
});

/** The validated settings of the web server. */
export type WebConfig = {
  /** The origin of the API. The server and the browser both call it. */
  readonly apiBaseUrl: string;
  readonly environment: string;
  readonly serviceVersion: string;
  /** The OTLP/HTTP traces URL that the browser sends spans to. Unset: the browser does not export. */
  readonly browserTracesUrl: string | undefined;
  /** True for `next dev` (`NODE_ENV=development`). */
  readonly isDevelopment: boolean;
};

/**
 * Reads and validates the settings at request time. It throws a `ZodError` when a value is invalid.
 *
 * @param source - The environment variables. Defaults to the process environment.
 * @returns The settings.
 */
export function loadWebConfig(
  source: Readonly<Record<string, string | undefined>> = process.env,
): WebConfig {
  const parsed = EnvironmentSchema.parse(source);
  return {
    apiBaseUrl: parsed.SAMPLE_WEB_API_URL,
    environment: parsed.SAMPLE_WEB_ENVIRONMENT,
    serviceVersion: parsed.SAMPLE_WEB_VERSION,
    browserTracesUrl: parsed.SAMPLE_WEB_BROWSER_TRACES_URL,
    isDevelopment: parsed.NODE_ENV === 'development',
  };
}

/**
 * Tells whether code runs in the Node.js runtime of Next.js (not the Edge runtime).
 * Next.js replaces `process.env.NEXT_RUNTIME` when it builds, so each runtime keeps only its own code.
 */
export const isNodeRuntime: boolean = process.env.NEXT_RUNTIME === 'nodejs';
