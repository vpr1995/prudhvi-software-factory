import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  formatLongDate,
  formatTripRange,
  formatVisitDate,
  parseDateParts,
  sortTripsNewestFirst,
  toSortKey,
} from '../../../web/lib/dates';

describe('date formatting', () => {
  it('reads the parts of full and month-only dates', () => {
    expect(parseDateParts('2023-05-12')).toEqual({ year: 2023, month: 5, day: 12 });
    expect(parseDateParts('2019-10')).toEqual({ year: 2019, month: 10, day: undefined });
  });

  it('formats visit dates and long dates', () => {
    expect(formatVisitDate('2023-05-12')).toBe('May 12, 2023');
    expect(formatVisitDate('2019-10')).toBe('Oct 2019');
    expect(formatLongDate('1919-02-26')).toBe('February 26, 1919');
    expect(formatLongDate('1919-02')).toBe('February 1919');
  });

  it.each([
    [{ start: '2023-05-12' }, 'May 12, 2023'],
    [{ start: '2023-05-12', end: '2023-05-12' }, 'May 12, 2023'],
    [{ start: '2023-05-12', end: '2023-05-15' }, 'May 12–15, 2023'],
    [{ start: '2023-06-30', end: '2023-07-02' }, 'Jun 30 – Jul 2, 2023'],
    [{ start: '2022-12-30', end: '2023-01-02' }, 'Dec 30, 2022 – Jan 2, 2023'],
    [{ start: '2019-10' }, 'Oct 2019'],
    [{ start: '2019-10', end: '2019-11' }, 'Oct – Nov 2019'],
    [{ start: '2019-12', end: '2020-01' }, 'Dec 2019 – Jan 2020'],
    [{ start: '2019-10', end: '2019-10-05' }, 'Oct 2019 – Oct 5, 2019'],
  ])('formats the trip %o as %s', (trip, expected) => {
    expect(formatTripRange(trip)).toBe(expected);
  });

  it('sorts trips newest first, with month-only dates as the first day', () => {
    const trips = [
      { start: '2018-06-02', end: '2018-06-05' },
      { start: '2025-08-01', end: '2025-08-03' },
      { start: '2025-08-01' },
      { start: '2021-09' },
      { start: '2021-09-20' },
    ];
    expect(sortTripsNewestFirst(trips)).toEqual([
      { start: '2025-08-01', end: '2025-08-03' },
      { start: '2025-08-01' },
      { start: '2021-09-20' },
      { start: '2021-09' },
      { start: '2018-06-02', end: '2018-06-05' },
    ]);
    expect(toSortKey('2021-09')).toBe('2021-09-01');
  });
});

describe('date formatting in a US time zone', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does not move a date to the day before', () => {
    vi.stubEnv('TZ', 'America/Los_Angeles');
    // The trap: a date-only text is midnight UTC, which is the evening before in Los Angeles.
    expect(new Date('2024-07-04').getDate()).toBe(3);
    expect(formatVisitDate('2024-07-04')).toBe('Jul 4, 2024');
    expect(formatVisitDate('2023-01-01')).toBe('Jan 1, 2023');
    expect(formatLongDate('2026-10-20')).toBe('October 20, 2026');
    expect(formatTripRange({ start: '2022-12-30', end: '2023-01-01' })).toBe(
      'Dec 30, 2022 – Jan 1, 2023',
    );
  });
});
