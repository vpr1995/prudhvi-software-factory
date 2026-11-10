import { describe, expect, it } from 'vitest';

import {
  formatLocationLine,
  formatMonth,
  formatPeriod,
  formatPublishedMonth,
} from '../../../web/lib/format';

describe('formatMonth', () => {
  it('writes a month as a short English name and a year', () => {
    expect(formatMonth('2020-01')).toBe('Jan 2020');
    expect(formatMonth('2024-12')).toBe('Dec 2024');
  });
});

describe('formatPeriod', () => {
  it('shows Present when the role has no end month', () => {
    expect(formatPeriod('2020-01', null)).toBe('Jan 2020 – Present');
  });

  it('shows the end month when the role has ended', () => {
    expect(formatPeriod('2016-03', '2019-11')).toBe('Mar 2016 – Nov 2019');
  });
});

describe('formatLocationLine', () => {
  it('states the relocation claim, then lists the primary place first', () => {
    expect(formatLocationLine({ primary: 'Boston', also: ['Bay Area', 'Seattle', 'NYC'] })).toBe(
      'Open to relocation: Boston · Bay Area · Seattle · NYC',
    );
  });

  it('shows only the primary place when there are no other places', () => {
    expect(formatLocationLine({ primary: 'Boston', also: [] })).toBe('Open to relocation: Boston');
  });
});

describe('formatPublishedMonth', () => {
  it('writes an ISO date as a short month and a year, in UTC', () => {
    expect(formatPublishedMonth('2026-10-16T01:17:45.000Z')).toBe('Oct 2026');
    expect(formatPublishedMonth('2025-08-03T02:09:50.000Z')).toBe('Aug 2025');
    expect(formatPublishedMonth('2026-01-01T00:00:00.000Z')).toBe('Jan 2026');
  });

  it('throws when the text is not a date', () => {
    expect(() => formatPublishedMonth('not a date')).toThrow('not a date');
  });
});
