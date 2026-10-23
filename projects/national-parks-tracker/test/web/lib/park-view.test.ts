import { describe, expect, it } from 'vitest';

import {
  buildParkSummary,
  formatArea,
  formatCoordinates,
  getLatestTrip,
  getNeighbors,
  getNpsUrl,
} from '../../../web/lib/park-view';
import { fixtureData, summaryOf } from '../fixtures';

const parkOf = (id: string) => {
  const park = fixtureData.parks.find((candidate) => candidate.id === id);
  if (park === undefined) {
    throw new Error(id);
  }
  return park;
};

describe('park summaries', () => {
  it('builds the summary of a visited park from its newest trip', () => {
    expect(summaryOf('yosemite')).toMatchObject({
      isVisited: true,
      lastVisit: '2025-08-01',
      tripCount: 3,
      rating: undefined,
      stateNames: 'California',
      region: 'lower48',
    });
  });

  it('builds the summary of a park with no visit and no photo', () => {
    expect(buildParkSummary(parkOf('zion'), undefined, undefined)).toMatchObject({
      isVisited: false,
      lastVisit: undefined,
      tripCount: 0,
      thumbnail: undefined,
    });
    expect(getLatestTrip(undefined)).toBeUndefined();
  });

  it('uses the thumbnail of the photo', () => {
    const photo = fixtureData.photos['zion'];
    expect(summaryOf('zion').thumbnail).toEqual({
      src: photo?.thumbSrc,
      width: photo?.width,
      height: photo?.height,
    });
  });
});

describe('getNeighbors', () => {
  it('wraps around at both ends of the name order', () => {
    const first = getNeighbors(fixtureData.parks, 'acadia');
    expect(first.previous?.id).toBe('zion');
    expect(first.next?.id).toBe('american-samoa');
    const last = getNeighbors(fixtureData.parks, 'zion');
    expect(last.previous?.id).toBe('yosemite');
    expect(last.next?.id).toBe('acadia');
  });

  it('gives nothing for an unknown id or a single park', () => {
    expect(getNeighbors(fixtureData.parks, 'nowhere')).toEqual({
      previous: undefined,
      next: undefined,
    });
    expect(getNeighbors([parkOf('zion')], 'zion')).toEqual({
      previous: undefined,
      next: undefined,
    });
  });
});

describe('formatting', () => {
  it('formats the area with separators', () => {
    expect(formatArea(49_071)).toBe('49,071 acres (198.6 km²)');
  });

  it('formats the coordinates in each hemisphere', () => {
    expect(formatCoordinates(44.35, -68.21)).toBe('44.35° N, 68.21° W');
    expect(formatCoordinates(-14.25, 170.68)).toBe('14.25° S, 170.68° E');
  });

  it('links to nps.gov', () => {
    expect(getNpsUrl('zion')).toBe('https://www.nps.gov/zion/');
  });
});
