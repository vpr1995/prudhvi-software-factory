import { z } from 'zod';

/** The visits file that the production build reads. The path is relative to the `web/` folder. */
export const DEFAULT_VISITS_FILE = 'data/visits.json';

const FOLDER_NAME = /^[\w-]+$/;
const JSON_FILE_NAME = /^[\w.-]+\.json$/;

/**
 * Tells whether a path names a JSON file inside the project: relative to web/, with at most one
 * leading `../` (to reach `test/fixtures`). So a build reads only files of this project.
 *
 * @param value - The path.
 * @returns True when the path is allowed.
 */
function isProjectJsonPath(value: string): boolean {
  const parts = value.split('/');
  const fileName = parts.pop() ?? '';
  const folders = parts[0] === '..' ? parts.slice(1) : parts;
  return JSON_FILE_NAME.test(fileName) && folders.every((folder) => FOLDER_NAME.test(folder));
}

const VisitsFileSchema = z.string().trim().refine(isProjectJsonPath, {
  message: 'Use a relative path to a .json file in this project, for example data/visits.json.',
});

// One folder name next to web/out, for example out-e2e.
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
  NPT_VISITS_FILE: z.preprocess(emptyToUndefined, VisitsFileSchema.optional()),
  NPT_OUT_DIR: z.preprocess(emptyToUndefined, OutputFolderSchema.optional()),
});

/** The validated build settings of the web app. The site is static, so they apply at build time only. */
export type WebConfig = {
  /** The visits file, relative to `web/`. Default: `data/visits.json`. */
  readonly visitsFile: string;
  /**
   * The export folder, relative to `web/`. Unset: Next.js writes the export to `out/`.
   * The e2e build sets `out-e2e`, so it does not overwrite the production export.
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
  return {
    visitsFile: parsed.NPT_VISITS_FILE ?? DEFAULT_VISITS_FILE,
    outDir: parsed.NPT_OUT_DIR,
  };
}
