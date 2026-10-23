// Shared test data for the web tests: the real parks and photos with the e2e fixture visits.
import parksJson from '../../web/data/parks.json';
import photosJson from '../../web/data/photos.json';
import { buildParkSummaries } from '../../web/lib/park-view';
import type { ParkSummary } from '../../web/lib/search';
import { parseSiteData } from '../../web/lib/site-data';
import type { SiteData } from '../../web/lib/site-data';
import visitsJson from '../fixtures/visits.e2e.json';

/** The site data that the e2e build uses: 8 of 64 parks visited. */
export const fixtureData: SiteData = parseSiteData({
  parks: parksJson,
  photos: photosJson,
  visits: visitsJson,
});

/** The summaries of the 64 parks, sorted by name. */
export const fixtureSummaries: readonly ParkSummary[] = buildParkSummaries(fixtureData);

/**
 * Finds the summary of a park.
 *
 * @param id - The park id.
 * @returns The summary.
 */
export function summaryOf(id: string): ParkSummary {
  const summary = fixtureSummaries.find((park) => park.id === id);
  if (summary === undefined) {
    throw new Error(`No park "${id}" in the fixture data.`);
  }
  return summary;
}

/**
 * Builds a summary with test values.
 *
 * @param overrides - The values to change.
 * @returns The summary.
 */
export function makeSummary(overrides: Partial<ParkSummary> = {}): ParkSummary {
  return {
    id: 'zion',
    name: 'Zion',
    fullName: 'Zion National Park',
    states: ['UT'],
    stateNames: 'Utah',
    lat: 37.3,
    lng: -113.05,
    region: 'lower48',
    established: '1919-11-19',
    isVisited: false,
    lastVisit: undefined,
    tripCount: 0,
    rating: undefined,
    thumbnail: undefined,
    ...overrides,
  };
}
