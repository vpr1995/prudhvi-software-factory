import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import {
  CalendarDateSchema,
  ParkIdSchema,
  ParkPhotoSchema,
  ParkPhotosSchema,
  ParkSchema,
  ParksSchema,
  STATE_CODES,
  StateCodeSchema,
} from '../../src/contracts/park.ts';

const PARK = {
  id: 'zion',
  name: 'Zion',
  fullName: 'Zion National Park',
  states: ['UT'],
  coordinates: { lat: 37.3, lng: -113.05 },
  established: '1919-11-19',
  areaAcres: 147_243,
  description: 'Red rock canyons.',
  npsCode: 'zion',
};

const PHOTO = {
  src: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Zion.jpg',
  thumbSrc: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Zion.jpg/640px-Zion.jpg',
  width: 1280,
  height: 853,
  alt: 'The Virgin River in a red canyon',
  credit: 'Jane Doe',
  license: 'CC BY-SA 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
  sourceUrl: 'https://commons.wikimedia.org/wiki/File:Zion.jpg',
};

/**
 * Gives the path of each issue, joined with dots, for short assertions.
 *
 * @param result - A failed safeParse result.
 * @returns The issue paths.
 */
function issuePaths(result: z.ZodSafeParseResult<unknown>): string[] {
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
}

/**
 * Gives each issue as `path: message`.
 *
 * @param result - A failed safeParse result.
 * @returns The issues.
 */
function issuesOf(result: z.ZodSafeParseResult<unknown>): string[] {
  return result.success
    ? []
    : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
}

const AREA = 'Use the area in acres as a whole number above 0, without quotes, for example 147243.';

describe('ParkSchema', () => {
  it('accepts a valid park', () => {
    expect(ParkSchema.parse(PARK)).toEqual(PARK);
  });

  it.each([
    ['id', { id: 'Zion Park' }],
    ['name', { name: '  ' }],
    ['states.0', { states: ['XX'] }],
    ['states', { states: [] }],
    ['coordinates.lat', { coordinates: { lat: 91, lng: 0 } }],
    ['coordinates.lng', { coordinates: { lat: 0, lng: -181 } }],
    ['established', { established: '1919-02-30' }],
    ['established', { established: '11/19/1919' }],
    ['areaAcres', { areaAcres: 0 }],
    ['areaAcres', { areaAcres: 1.5 }],
    ['description', { description: '' }],
    ['npsCode', { npsCode: 'ZION' }],
  ])('rejects a bad %s', (path, change) => {
    expect(issuePaths(ParkSchema.safeParse({ ...PARK, ...change }))).toContain(path);
  });

  it.each([
    ['name', { name: '  ' }, 'Write the short name, for example "Zion".'],
    ['name', { name: 'x'.repeat(81) }, 'Use at most 80 characters.'],
    ['fullName', { fullName: 'x'.repeat(121) }, 'Use at most 120 characters.'],
    ['states', { states: [] }, 'Add at least one state code, for example ["UT"].'],
    [
      'states.0',
      { states: ['ut'] },
      'Use a two-letter state code in capitals, for example "UT". The territories are "AS" and "VI".',
    ],
    ['areaAcres', { areaAcres: 0 }, AREA],
    ['areaAcres', { areaAcres: 1.5 }, AREA],
    ['areaAcres', { areaAcres: '100' }, AREA],
    ['description', { description: '' }, 'Write a short description of the park.'],
    ['description', { description: 'x'.repeat(1001) }, 'Use at most 1000 characters.'],
    [
      'coordinates.lat',
      { coordinates: { lat: 91, lng: 0 } },
      'Use a latitude from -90 to 90 in decimal degrees, for example 37.3.',
    ],
  ])('says how to fix a bad %s', (path, change, message) => {
    expect(issuesOf(ParkSchema.safeParse({ ...PARK, ...change }))).toContain(`${path}: ${message}`);
  });

  it('names an unknown key and lists the allowed keys', () => {
    expect(issuesOf(ParkSchema.safeParse({ ...PARK, visited: true }))).toEqual([
      ': Remove or rename the unknown field "visited". The allowed fields are "id", "name", "fullName", "states", "coordinates", "established", "areaAcres", "description", "npsCode".',
    ]);
  });

  it('gives the index of the bad park in a list', () => {
    expect(issuePaths(ParksSchema.safeParse([PARK, { ...PARK, npsCode: 'x' }]))).toEqual([
      '1.npsCode',
    ]);
    expect(issuesOf(ParksSchema.safeParse([]))).toEqual([': Add at least one park.']);
  });
});

describe('small schemas', () => {
  it('checks park ids', () => {
    expect(ParkIdSchema.safeParse('great-smoky-mountains').success).toBe(true);
    expect(ParkIdSchema.safeParse('zion-').success).toBe(false);
    expect(ParkIdSchema.safeParse('1zion').success).toBe(false);
  });

  it('checks state codes', () => {
    expect(StateCodeSchema.safeParse('VI').success).toBe(true);
    expect(StateCodeSchema.safeParse('ut').success).toBe(false);
  });

  it('allows the 50 states, DC, American Samoa and the Virgin Islands, and no territory without a map region', () => {
    expect(STATE_CODES).toHaveLength(53);
    expect(new Set(STATE_CODES).size).toBe(53);
    for (const code of ['GU', 'MP', 'PR']) {
      expect(StateCodeSchema.safeParse(code).success).toBe(false);
    }
  });

  it('checks calendar dates, leap years included', () => {
    expect(CalendarDateSchema.safeParse('2024-02-29').success).toBe(true);
    expect(CalendarDateSchema.safeParse('2023-02-29').success).toBe(false);
    expect(CalendarDateSchema.safeParse('2023-13-01').success).toBe(false);
  });
});

describe('ParkPhotoSchema', () => {
  it('accepts a valid photo, with or without a license link', () => {
    expect(ParkPhotoSchema.parse(PHOTO)).toEqual(PHOTO);
    const { licenseUrl: _licenseUrl, ...noLicenseUrl } = PHOTO;
    expect(ParkPhotoSchema.safeParse(noLicenseUrl).success).toBe(true);
  });

  it.each([
    ['src', { src: 'http://upload.wikimedia.org/a.jpg' }],
    ['src', { src: 'https://example.com/a.jpg' }],
    ['thumbSrc', { thumbSrc: 'javascript:alert(1)' }],
    ['width', { width: 0 }],
    ['alt', { alt: '' }],
    ['licenseUrl', { licenseUrl: 'ftp://example.com' }],
    ['licenseUrl', { licenseUrl: 'http://creativecommons.org/licenses/by-sa/3.0/' }],
    ['sourceUrl', { sourceUrl: 'http://commons.wikimedia.org/x' }],
  ])('rejects a bad %s', (path, change) => {
    expect(issuePaths(ParkPhotoSchema.safeParse({ ...PHOTO, ...change }))).toContain(path);
  });

  it('says how to fix a bad link, a bad size and an unknown key', () => {
    expect(
      issuesOf(
        ParkPhotoSchema.safeParse({
          ...PHOTO,
          licenseUrl: 'http://creativecommons.org/licenses/by-sa/3.0/',
          src: 'https://example.com/a.jpg',
          width: -1,
          author: 'X',
        }),
      ),
    ).toEqual([
      'src: Use an https://upload.wikimedia.org/ link.',
      'width: Use the size in pixels as a whole number above 0, for example 1280.',
      'licenseUrl: Use an https:// link to the license.',
      ': Remove or rename the unknown field "author". The allowed fields are "src", "thumbSrc", "width", "height", "alt", "credit", "license", "licenseUrl", "sourceUrl".',
    ]);
    expect(issuesOf(ParkPhotoSchema.safeParse({ ...PHOTO, credit: 'x'.repeat(401) }))).toEqual([
      'credit: Use at most 400 characters.',
    ]);
  });

  it('gives the park id of a bad photo', () => {
    expect(issuePaths(ParkPhotosSchema.safeParse({ zion: { ...PHOTO, credit: '' } }))).toEqual([
      'zion.credit',
    ]);
  });
});
