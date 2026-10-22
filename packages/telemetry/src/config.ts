import { z } from 'zod';

/** Share of root traces kept outside prod. */
export const DEFAULT_SAMPLE_RATIO = 1;
/** Share of root traces kept in prod (parent-based sampling keeps child spans of a kept trace). */
export const PROD_SAMPLE_RATIO = 0.1;

const EnvSchema = z.object({
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
  OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: z.url().optional(),
  OTEL_TRACES_EXPORTER: z.enum(['otlp', 'none']).optional(),
  OTEL_TRACES_SAMPLER_ARG: z.coerce.number().min(0).max(1).optional(),
  AWS_LAMBDA_FUNCTION_NAME: z.string().optional(),
  AWS_REGION: z.string().optional(),
});

/** Telemetry settings read once from the environment. */
export type TelemetryConfig = {
  /** `true` when spans go to an OTLP endpoint. */
  readonly isExportEnabled: boolean;
  /** Share of root traces to keep, from 0 to 1. */
  readonly sampleRatio: number;
  /** The Lambda function name, when the code runs in Lambda. */
  readonly lambdaFunctionName: string | undefined;
  /** The AWS region, when set. */
  readonly awsRegion: string | undefined;
};

/**
 * Picks the default sample ratio for an environment.
 *
 * @param environment - The deployment environment, for example `local`, `dev` or `prod`.
 * @returns 10% for prod and 100% otherwise.
 */
export function defaultSampleRatio(environment: string): number {
  return environment === 'prod' ? PROD_SAMPLE_RATIO : DEFAULT_SAMPLE_RATIO;
}

/**
 * Reads the telemetry settings from the environment. Empty values count as unset.
 *
 * Spans are exported only when an OTLP endpoint is set and `OTEL_TRACES_EXPORTER` is not `none`.
 *
 * @param environment - The deployment environment. It sets the default sample ratio.
 * @param source - The environment variables. Defaults to `process.env`.
 * @returns The parsed settings.
 */
export function loadTelemetryConfig(
  environment: string,
  source: Readonly<Record<string, string | undefined>> = process.env,
): TelemetryConfig {
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value !== ''),
  );
  const env = EnvSchema.parse(cleaned);
  const endpoint = env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ?? env.OTEL_EXPORTER_OTLP_ENDPOINT;

  return {
    isExportEnabled: endpoint !== undefined && env.OTEL_TRACES_EXPORTER !== 'none',
    sampleRatio: env.OTEL_TRACES_SAMPLER_ARG ?? defaultSampleRatio(environment),
    lambdaFunctionName: env.AWS_LAMBDA_FUNCTION_NAME,
    awsRegion: env.AWS_REGION,
  };
}
