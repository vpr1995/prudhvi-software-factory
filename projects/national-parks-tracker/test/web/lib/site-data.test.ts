import { describe, expect, it } from 'vitest';

import parksJson from '../../../web/data/parks.json';
import photosJson from '../../../web/data/photos.json';
import {
  formatFieldPath,
  parseSiteData,
  SiteDataError,
  toIsoDate,
} from '../../../web/lib/site-data';

const VALID = { parks: parksJson, photos: photosJson, visits: {} };

/**
 * Runs parseSiteData and gives the problems it reports.
 *
 * @param raw - The raw data.
 * @returns The problems, or an empty list when the data is valid.
 */
function problemsOf(raw: Parameters<typeof parseSiteData>[0], today?: string): readonly string[] {
  try {
    parseSiteData(raw, today === undefined ? {} : { today });
    return [];
  } catch (error) {
    if (error instanceof SiteDataError) {
      return error.problems;
    }
    throw error;
  }
}

describe('parseSiteData', () => {
  it('accepts the real data and sorts the parks by name', () => {
    const data = parseSiteData(VALID);
    expect(data.parks).toHaveLength(64);
    expect(data.parks[0]?.name).toBe('Acadia');
    expect(data.parks.at(-1)?.name).toBe('Zion');
  });

  it('names the file, the park and the field of a bad visit', () => {
    expect(
      problemsOf({
        ...VALID,
        visits: { zion: { trips: [{ start: '2023-05-15', end: '2023-05-01' }] } },
      }),
    ).toEqual([
      'web/data/visits.json: park "zion", field "trips[0].end": The end date must be on or after the start date.',
    ]);
    expect(problemsOf({ ...VALID, visits: [] })[0]).toMatch(/^web\/data\/visits\.json: /);
  });

  it('names a bad park by its id, or by its number when it has no id', () => {
    const [first, ...rest] = parksJson;
    expect(problemsOf({ ...VALID, parks: [{ ...first, areaAcres: -1 }, ...rest] })[0]).toBe(
      'web/data/parks.json: park "acadia", field "areaAcres": Use the area in acres as a whole number above 0, without quotes, for example 147243.',
    );
    expect(problemsOf({ ...VALID, parks: [{ name: 'X' }] })[0]).toMatch(
      /^web\/data\/parks\.json: park number 1, field "id"/,
    );
    expect(problemsOf({ ...VALID, parks: 'none' })).toEqual([
      'web/data/parks.json: Write the parks as a list in square brackets [ ].',
    ]);
  });

  it('reports unknown park ids and duplicate ids', () => {
    expect(
      problemsOf({ ...VALID, visits: { 'zion-np': { trips: [{ start: '2020-01' }] } } }),
    ).toEqual([
      'web/data/visits.json: park "zion-np" is not a known park id. Use an id from web/data/parks.json, for example "zion".',
    ]);
    const [first] = parksJson;
    expect(problemsOf({ ...VALID, parks: [...parksJson, first] })).toEqual([
      'web/data/parks.json: park "acadia", field "id": This id is used twice.',
    ]);
  });

  it('rejects a trip after today, with today from the options or the clock', () => {
    const visits = { zion: { trips: [{ start: '2026-10-24' }] } };
    expect(problemsOf({ ...VALID, visits }, '2026-10-23')).toEqual([
      'web/data/visits.json: park "zion", field "trips[0].start": This date is in the future. Use a date on or before today (2026-10-23).',
    ]);
    expect(problemsOf({ ...VALID, visits }, '2026-10-24')).toEqual([]);
    const tomorrow = toIsoDate(new Date(Date.now() + 86_400_000));
    expect(
      problemsOf({ ...VALID, visits: { zion: { trips: [{ start: tomorrow }] } } }),
    ).toHaveLength(1);
  });

  it('gives the build date in UTC', () => {
    expect(toIsoDate(new Date('2026-10-23T23:30:00-07:00'))).toBe('2026-10-24');
  });

  it('shows at most 8 problems in the message', () => {
    const visits = Object.fromEntries(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((id) => [id, {}]),
    );
    let error: unknown;
    try {
      parseSiteData({ ...VALID, visits });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(SiteDataError);
    expect(error instanceof SiteDataError && error.message).toContain('and 2 more.');
    expect(error instanceof SiteDataError && error.name).toBe('SiteDataError');
  });
});

describe('formatFieldPath', () => {
  it('writes paths the way a person reads them', () => {
    expect(formatFieldPath([])).toBe('(the whole entry)');
    expect(formatFieldPath(['photos', 0, 'src'])).toBe('photos[0].src');
  });
});
