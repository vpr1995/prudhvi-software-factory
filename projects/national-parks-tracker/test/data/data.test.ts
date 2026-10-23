import { access, readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ParkPhotosSchema, ParksSchema } from '../../src/contracts/park.ts';
import type { Park } from '../../src/contracts/park.ts';
import { createVisitsSchema } from '../../src/contracts/visit.ts';
import { containsPoint, getRegion, LOWER_48_BOUNDS } from '../../web/lib/regions.ts';
import { toIsoDate } from '../../web/lib/site-data.ts';

import { findPhotoProblem, isPhotoCandidate } from './photo-metadata.ts';

const PARK_COUNT = 64;
// Sequoia and Kings Canyon share one nps.gov site, so they share one code. No other pair may.
const SHARED_NPS_CODE = { code: 'seki', parks: ['kings-canyon', 'sequoia'] };
const OUTSIDE_LOWER_48 = 12;

/**
 * Reads a JSON file of the project.
 *
 * @param path - The path, relative to the project folder.
 * @returns The parsed JSON.
 */
async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(`../../${path}`, import.meta.url), 'utf8'));
}

const parks: readonly Park[] = ParksSchema.parse(await readJson('web/data/parks.json'));
const photos = ParkPhotosSchema.parse(await readJson('web/data/photos.json'));
const parkIds = new Set(parks.map((park) => park.id));
const VisitsSchema = createVisitsSchema(toIsoDate(new Date()));
const PHOTOS_FOLDER = 'web/public/photos';
const PROJECT_FOLDER = fileURLToPath(new URL('../../', import.meta.url));

/**
 * Tells whether a project file exists.
 *
 * @param path - The path, relative to the project folder.
 * @returns True when the file exists.
 */
async function exists(path: string): Promise<boolean> {
  try {
    await access(new URL(`../../${path}`, import.meta.url));
    return true;
  } catch {
    return false;
  }
}

/**
 * Lists every file under the owner photo folder. The folder is optional.
 *
 * @returns The paths, relative to the project folder.
 */
async function listOwnerPhotoFiles(): Promise<string[]> {
  if (!(await exists(PHOTOS_FOLDER))) {
    return [];
  }
  const entries = await readdir(new URL(`../../${PHOTOS_FOLDER}`, import.meta.url), {
    recursive: true,
    withFileTypes: true,
  });
  return entries
    .filter((entry) => entry.isFile() && isPhotoCandidate(entry.name))
    .map((entry) => relative(PROJECT_FOLDER, join(entry.parentPath, entry.name)));
}

describe('web/data/parks.json', () => {
  it('lists exactly 64 parks with unique ids', () => {
    expect(parks).toHaveLength(PARK_COUNT);
    expect(parkIds.size).toBe(PARK_COUNT);
  });

  it('has unique nps.gov codes, except the Sequoia and Kings Canyon pair', () => {
    const idsByCode = new Map<string, string[]>();
    for (const park of parks) {
      idsByCode.set(park.npsCode, [...(idsByCode.get(park.npsCode) ?? []), park.id]);
    }
    const shared = [...idsByCode].filter(([, ids]) => ids.length > 1);
    expect(shared.map(([code, ids]) => ({ code, parks: ids.toSorted() }))).toEqual([
      SHARED_NPS_CODE,
    ]);
  });

  it('includes Chiricahua, in Arizona, established 2026-10-20', () => {
    expect(parks.find((park) => park.id === 'chiricahua')).toMatchObject({
      states: ['AZ'],
      established: '2026-10-20',
      npsCode: 'chir',
    });
  });

  it('has 12 parks outside the lower 48 and 5 in Utah', () => {
    const outside = parks.filter((park) =>
      park.states.some((state) => ['AK', 'HI', 'AS', 'VI'].includes(state)),
    );
    expect(outside).toHaveLength(OUTSIDE_LOWER_48);
    expect(parks.filter((park) => park.states.includes('UT'))).toHaveLength(5);
  });

  it('puts every park inside the United States and its territories', () => {
    // From American Samoa (14° S, 171° W) to northern Alaska (68° N) and the Virgin Islands (65° W).
    const isInRange = ({ lat, lng }: Park['coordinates']): boolean =>
      lat > -15 && lat < 72 && lng > -171 && lng < -64;
    expect(parks.filter((park) => !isInRange(park.coordinates)).map((park) => park.id)).toEqual([]);
  });

  it('puts every lower 48 park inside the lower 48 view', () => {
    const outsideView = parks.filter(
      (park) =>
        getRegion(park.states) === 'lower48' && !containsPoint(LOWER_48_BOUNDS, park.coordinates),
    );
    expect(outsideView.map((park) => park.id)).toEqual([]);
  });
});

describe('web/data/photos.json', () => {
  it('has a key for known parks only', () => {
    expect(Object.keys(photos).filter((id) => !parkIds.has(id))).toEqual([]);
  });
});

describe('owner photos', () => {
  it('has a file in web/public for each photo in the real web/data/visits.json', async () => {
    // The e2e fixture has a missing photo on purpose. The real file must not.
    const visits = VisitsSchema.parse(await readJson('web/data/visits.json'));
    const sources = Object.values(visits).flatMap((visit) =>
      (visit.photos ?? []).map((photo) => `web/public${photo.src}`),
    );
    const missing: string[] = [];
    for (const source of sources) {
      if (!(await exists(source))) {
        missing.push(source);
      }
    }
    expect(missing, 'Put each photo file in web/public/photos/<park-id>/').toEqual([]);
  });

  it('has no EXIF or XMP data (GPS position) in any file under web/public/photos', async () => {
    const problems: string[] = [];
    for (const file of await listOwnerPhotoFiles()) {
      const problem = findPhotoProblem(
        file,
        await readFile(new URL(`../../${file}`, import.meta.url)),
      );
      if (problem !== undefined) {
        problems.push(problem);
      }
    }
    expect(problems).toEqual([]);
  });
});

describe('visit files', () => {
  it.each(['web/data/visits.json', 'test/fixtures/visits.e2e.json'])(
    '%s is valid and names known parks',
    async (path) => {
      const visits = VisitsSchema.parse(await readJson(path));
      expect(Object.keys(visits).filter((id) => !parkIds.has(id))).toEqual([]);
    },
  );
});
