import { z } from 'zod';

// The only module of the web app that reads the environment. The build reads it once, in
// next.config.ts. The site is static, so these settings apply at build time only.

// One folder name next to web/out, for example out-e2e. The e2e build uses it, so it does not
// overwrite the production export.
const OutputFolderSchema = z
  .string()
  .trim()
  .regex(
    /^out$|^out-[a-z0-9-]+$/,
    'Use a folder name that starts with "out", for example out-e2e.',
  );

// An empty value counts as not set.
const emptyToUndefined = (value: unknown): unknown => (value === '' ? undefined : value);

const EnvironmentSchema = z.object({
  PORTFOLIO_OUT_DIR: z.preprocess(emptyToUndefined, OutputFolderSchema.optional()),
});

/** The validated build settings of the web app. */
export type WebConfig = {
  /**
   * The export folder, relative to `web/`. Unset: Next.js writes the export to `out/`.
   * The e2e build sets `out-e2e`.
   */
  readonly outDir: string | undefined;
};

/**
 * Reads and validates the build settings. It throws a `ZodError` when a value is invalid.
 *
 * @param source - The environment variables. Defaults to the process environment.
 * @returns The settings.
 */
export function loadWebConfig(
  source: Readonly<Record<string, string | undefined>> = process.env,
): WebConfig {
  const parsed = EnvironmentSchema.parse(source);
  return { outDir: parsed.PORTFOLIO_OUT_DIR };
}
