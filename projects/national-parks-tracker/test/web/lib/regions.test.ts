import { describe, expect, it } from 'vitest';

import { STATE_CODES } from '../../../src/contracts/park.ts';
import {
  containsPoint,
  countOutside,
  getRegion,
  getViewTarget,
  LOWER_48_BOUNDS,
  REGIONS,
  SINGLE_PARK_ZOOM,
} from '../../../web/lib/regions';
import { fixtureSummaries, summaryOf } from '../fixtures';

describe('regions', () => {
  it('finds the region from the first state', () => {
    expect(getRegion(['AK'])).toBe('alaska');
    expect(getRegion(['HI'])).toBe('hawaii');
    expect(getRegion(['AS'])).toBe('american-samoa');
    expect(getRegion(['VI'])).toBe('virgin-islands');
    expect(getRegion(['CA', 'NV'])).toBe('lower48');
    expect(getRegion([])).toBe('lower48');
  });

  it('gives every allowed state code a region with a view button, and keeps only the contiguous states and DC in the lower 48', () => {
    const lower48 = STATE_CODES.filter((code) => getRegion([code]) === 'lower48');
    expect(lower48.toSorted()).toEqual(
      STATE_CODES.filter((code) => !['AK', 'HI', 'AS', 'VI'].includes(code)).toSorted(),
    );
    // The 48 contiguous states and DC. A territory such as PR would fall into the lower 48 here.
    expect(lower48).toHaveLength(49);
    for (const code of STATE_CODES) {
      expect(REGIONS).toContain(getRegion([code]));
    }
  });

  it('counts 12 parks outside the lower 48 view', () => {
    expect(countOutside(LOWER_48_BOUNDS, fixtureSummaries)).toEqual({
      total: 12,
      byRegion: { lower48: 0, alaska: 8, hawaii: 2, 'american-samoa': 1, 'virgin-islands': 1 },
    });
  });

  it('gives a box for a region with several parks and a point for a single park', () => {
    expect(getViewTarget('lower48', fixtureSummaries)).toEqual({
      kind: 'bounds',
      bounds: LOWER_48_BOUNDS,
    });
    const alaska = getViewTarget('alaska', fixtureSummaries);
    expect(alaska.kind).toBe('bounds');
    const denali = summaryOf('denali');
    expect(alaska.kind === 'bounds' && containsPoint(alaska.bounds, denali)).toBe(true);
    const samoa = summaryOf('american-samoa');
    expect(getViewTarget('american-samoa', fixtureSummaries)).toEqual({
      kind: 'point',
      lat: samoa.lat,
      lng: samoa.lng,
      zoom: SINGLE_PARK_ZOOM,
    });
  });

  it('fits every park for "all", and falls back to the lower 48 with no parks', () => {
    const all = getViewTarget('all', fixtureSummaries);
    expect(all.kind === 'bounds' && countOutside(all.bounds, fixtureSummaries).total).toBe(0);
    expect(getViewTarget('hawaii', [])).toEqual({ kind: 'bounds', bounds: LOWER_48_BOUNDS });
  });

  it('counts a point on the edge as inside', () => {
    expect(containsPoint(LOWER_48_BOUNDS, { lat: 24.4, lng: -66.9 })).toBe(true);
    expect(containsPoint(LOWER_48_BOUNDS, { lat: 24.3, lng: -100 })).toBe(false);
  });
});
