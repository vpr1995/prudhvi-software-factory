import { z } from 'zod';

const DEFAULT_PORT = 3000;
const MAX_PORT = 65_535;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_VERSION = '0.0.0';

/** The service name. It is the `service.name` of logs and traces. */
export const SERVICE_NAME = 'sample-fullstack-api';

const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'] as const;

const EnvironmentSchema = z.object({
  SAMPLE_FULLSTACK_API_PORT: z.coerce.number().int().min(0).max(MAX_PORT).default(DEFAULT_PORT),
  SAMPLE_FULLSTACK_API_HOST: z.string().min(1).default(DEFAULT_HOST),
  SAMPLE_FULLSTACK_API_LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  SAMPLE_FULLSTACK_API_ENVIRONMENT: z.string().min(1).default('local'),
  SAMPLE_FULLSTACK_API_VERSION: z.string().min(1).default(DEFAULT_VERSION),
  SAMPLE_FULLSTACK_API_CORS_ORIGINS: z.string().default(''),
});

/** The validated settings of the API. */
export type Config = {
  readonly serviceName: string;
  readonly serviceVersion: string;
  readonly environment: string;
  readonly host: string;
  readonly port: number;
  readonly logLevel: (typeof LOG_LEVELS)[number];
  /** Browser origins allowed to call the API. Empty means no CORS headers. */
  readonly corsOrigins: readonly string[];
};

/**
 * Reads and validates the settings. It throws a `ZodError` when a value is invalid.
 *
 * @param source - The environment variables. Defaults to the process environment.
 * @returns The settings.
 */
export function loadConfig(
  source: Readonly<Record<string, string | undefined>> = process.env,
): Config {
  const parsed = EnvironmentSchema.parse(source);
  return {
    serviceName: SERVICE_NAME,
    serviceVersion: parsed.SAMPLE_FULLSTACK_API_VERSION,
    environment: parsed.SAMPLE_FULLSTACK_API_ENVIRONMENT,
    host: parsed.SAMPLE_FULLSTACK_API_HOST,
    port: parsed.SAMPLE_FULLSTACK_API_PORT,
    logLevel: parsed.SAMPLE_FULLSTACK_API_LOG_LEVEL,
    corsOrigins: parsed.SAMPLE_FULLSTACK_API_CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin !== ''),
  };
}
