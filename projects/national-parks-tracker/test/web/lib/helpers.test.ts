import { describe, expect, it } from 'vitest';

import { joinClassNames } from '../../../web/lib/class-names';
import { getRatingLabel, getRatingStars } from '../../../web/lib/rating';
import { formatStateNames, getStateName } from '../../../web/lib/states';
import { computeStats } from '../../../web/lib/stats';
import { fixtureSummaries, makeSummary } from '../fixtures';

describe('states', () => {
  it('gives full state and territory names', () => {
    expect(getStateName('UT')).toBe('Utah');
    expect(getStateName('VI')).toBe('U.S. Virgin Islands');
    expect(formatStateNames(['CA', 'NV'])).toBe('California, Nevada');
  });
});

describe('rating', () => {
  it('gives the accessible text and the stars', () => {
    expect(getRatingLabel(4)).toBe('Rated 4 out of 5');
    expect(getRatingStars(4)).toBe('★★★★☆');
    expect(getRatingStars(9)).toBe('★★★★★');
    expect(getRatingStars(-1)).toBe('☆☆☆☆☆');
  });
});

describe('joinClassNames', () => {
  it('leaves out empty parts', () => {
    expect(joinClassNames('a', false, undefined, '', 'b')).toBe('a b');
  });
});

describe('computeStats', () => {
  it('counts the fixture visits', () => {
    expect(computeStats(fixtureSummaries)).toEqual({
      visitedCount: 8,
      totalCount: 64,
      statesVisited: 8,
      tripCount: 10,
      latestVisit: { parkId: 'yosemite', parkName: 'Yosemite', date: '2025-08-01' },
    });
  });

  it('has no latest visit when nothing is visited', () => {
    expect(computeStats([makeSummary()])).toMatchObject({
      visitedCount: 0,
      tripCount: 0,
      latestVisit: undefined,
    });
  });

  it('compares a month-only visit as the first day of the month', () => {
    const stats = computeStats([
      makeSummary({ id: 'a', name: 'A', isVisited: true, lastVisit: '2020-05-02', tripCount: 1 }),
      makeSummary({ id: 'b', name: 'B', isVisited: true, lastVisit: '2020-05', tripCount: 1 }),
      makeSummary({ id: 'c', name: 'C', isVisited: true, lastVisit: undefined, tripCount: 0 }),
    ]);
    expect(stats.latestVisit?.parkId).toBe('a');
  });
});
