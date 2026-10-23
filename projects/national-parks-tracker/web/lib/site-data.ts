import type { z } from 'zod';

import { ParkPhotosSchema, ParksSchema } from '../../src/contracts/park.ts';
import type { Park, ParkPhotos } from '../../src/contracts/park.ts';
import { createVisitsSchema } from '../../src/contracts/visit.ts';
import type { Visits } from '../../src/contracts/visit.ts';

const MAX_REPORTED_PROBLEMS = 8;

/** The three data files of the site, after validation. */
export type SiteData = {
  /** Every park, sorted by name. */
  readonly parks: readonly Park[];
  readonly photos: ParkPhotos;
  readonly visits: Visits;
};

/** The raw content of the three data files, before validation. */
export type RawSiteData = {
  readonly parks: unknown;
  readonly photos: unknown;
  readonly visits: unknown;
};

/** The names of the three data files, for the error messages. */
export type SiteDataFiles = {
  readonly parks: string;
  readonly photos: string;
  readonly visits: string;
};

/** The default file names, relative to the project folder. */
export const DEFAULT_SITE_DATA_FILES: SiteDataFiles = {
  parks: 'web/data/parks.json',
  photos: 'web/data/photos.json',
  visits: 'web/data/visits.json',
};

/** Options of `parseSiteData`. */
export type SiteDataOptions = {
  /** The file names for the messages. */
  readonly files?: SiteDataFiles;
  /** Today, `YYYY-MM-DD`. No trip date may be after it. The default is the build date (UTC). */
  readonly today?: string;
};

/**
 * Gives the date of a moment as `YYYY-MM-DD` in UTC. UTC is never behind a US time zone, so a trip
 * that starts today in the United States is never in the future.
 *
 * @param now - The moment.
 * @returns The date.
 */
export function toIsoDate(now: Date): string {
  return now.toISOString().slice(0, 'YYYY-MM-DD'.length);
}

/** A problem in a data file. The message names the file, the park and the field. */
export class SiteDataError extends Error {
  /** Each problem on its own line. */
  readonly problems: readonly string[];

  /**
   * @param problems - One line for each problem.
   */
  constructor(problems: readonly string[]) {
    const shown = problems.slice(0, MAX_REPORTED_PROBLEMS);
    const more = problems.length - shown.length;
    super(
      [
        'The park data is not valid. Fix these problems, then build again:',
        ...shown.map((problem) => `  - ${problem}`),
        ...(more > 0 ? [`  - and ${String(more)} more.`] : []),
      ].join('\n'),
    );
    this.name = 'SiteDataError';
    this.problems = problems;
  }
}

/**
 * Writes a field path the way a person reads it, for example `trips[0].end`.
 *
 * @param path - The path below the park.
 * @returns The path text, or `(the whole entry)` when the path is empty.
 */
export function formatFieldPath(path: readonly PropertyKey[]): string {
  if (path.length === 0) {
    return '(the whole entry)';
  }
  return path
    .map((key, index) => {
      if (typeof key === 'number') {
        return `[${String(key)}]`;
      }
      return index === 0 ? String(key) : `.${String(key)}`;
    })
    .join('');
}

const describeKeyedIssue = (file: string, issue: z.core.$ZodIssue): string => {
  const [parkId, ...field] = issue.path;
  if (parkId === undefined) {
    return `${file}: ${issue.message}`;
  }
  return `${file}: park "${String(parkId)}", field "${formatFieldPath(field)}": ${issue.message}`;
};

const describeParkIssue = (file: string, raw: unknown, issue: z.core.$ZodIssue): string => {
  const [index, ...field] = issue.path;
  if (typeof index !== 'number') {
    return `${file}: ${issue.message}`;
  }
  const entry: unknown = Array.isArray(raw) ? raw[index] : undefined;
  const id =
    typeof entry === 'object' && entry !== null && 'id' in entry && typeof entry.id === 'string'
      ? `park "${entry.id}"`
      : `park number ${String(index + 1)}`;
  return `${file}: ${id}, field "${formatFieldPath(field)}": ${issue.message}`;
};

const unknownKeys = (file: string, keys: readonly string[], known: ReadonlySet<string>): string[] =>
  keys
    .filter((key) => !known.has(key))
    .map(
      (key) =>
        `${file}: park "${key}" is not a known park id. Use an id from web/data/parks.json, for example "zion".`,
    );

const duplicateIds = (file: string, parks: readonly Park[]): string[] => {
  const seen = new Set<string>();
  const problems: string[] = [];
  for (const park of parks) {
    if (seen.has(park.id)) {
      problems.push(`${file}: park "${park.id}", field "id": This id is used twice.`);
    }
    seen.add(park.id);
  }
  return problems;
};

/**
 * Validates the three data files and checks that they agree. It runs at build time, so a mistake
 * in a data file stops `next build` with a message that names the file, the park and the field.
 *
 * @param raw - The parsed JSON of each file.
 * @param options - The file names for the messages, and today.
 * @returns The valid data, with the parks sorted by name.
 * @throws {SiteDataError} When a file is not valid.
 */
export function parseSiteData(raw: RawSiteData, options: SiteDataOptions = {}): SiteData {
  const { files = DEFAULT_SITE_DATA_FILES, today = toIsoDate(new Date()) } = options;
  const parks = ParksSchema.safeParse(raw.parks);
  const photos = ParkPhotosSchema.safeParse(raw.photos);
  const visits = createVisitsSchema(today).safeParse(raw.visits);
  const problems = [
    ...(parks.success
      ? []
      : parks.error.issues.map((issue) => describeParkIssue(files.parks, raw.parks, issue))),
    ...(photos.success
      ? []
      : photos.error.issues.map((issue) => describeKeyedIssue(files.photos, issue))),
    ...(visits.success
      ? []
      : visits.error.issues.map((issue) => describeKeyedIssue(files.visits, issue))),
  ];
  if (!parks.success || !photos.success || !visits.success) {
    throw new SiteDataError(problems);
  }
  const knownIds = new Set(parks.data.map((park) => park.id));
  const crossProblems = [
    ...duplicateIds(files.parks, parks.data),
    ...unknownKeys(files.photos, Object.keys(photos.data), knownIds),
    ...unknownKeys(files.visits, Object.keys(visits.data), knownIds),
  ];
  if (crossProblems.length > 0) {
    throw new SiteDataError(crossProblems);
  }
  return {
    parks: parks.data.toSorted((left, right) => left.name.localeCompare(right.name, 'en')),
    photos: photos.data,
    visits: visits.data,
  };
}
