import { describe, expect, it } from 'vitest';

import {
  countByStatus,
  DEFAULT_LIST_STATE,
  isSort,
  isStatus,
  matchesQuery,
  normalizeSearchText,
  selectParks,
} from '../../../web/lib/search';
import { fixtureSummaries, makeSummary, summaryOf } from '../fixtures';

const names = (state: Partial<typeof DEFAULT_LIST_STATE>): string[] =>
  selectParks(fixtureSummaries, { ...DEFAULT_LIST_STATE, ...state }).map((park) => park.name);

describe('normalizeSearchText', () => {
  it('drops accents, the ʻokina, apostrophes and extra spaces', () => {
    expect(normalizeSearchText('Haleakalā')).toBe('haleakala');
    expect(normalizeSearchText('Hawaiʻi  Volcanoes ')).toBe('hawaii volcanoes');
    expect(normalizeSearchText('Wrangell–St. Elias')).toBe('wrangell st. elias');
    expect(normalizeSearchText("Hawai'i")).toBe('hawaii');
  });
});

describe('search', () => {
  it('finds parks without the accents and the ʻokina', () => {
    expect(names({ query: 'haleakala' })).toEqual(['Haleakalā']);
    expect(names({ query: 'hawaii' })).toContain('Hawaiʻi Volcanoes');
    expect(names({ query: 'wrangell st' })).toEqual(['Wrangell–St. Elias']);
  });

  it('matches state names and state codes', () => {
    expect(names({ query: 'utah' })).toEqual([
      'Arches',
      'Bryce Canyon',
      'Canyonlands',
      'Capitol Reef',
      'Zion',
    ]);
    expect(names({ query: 'AZ' })).toEqual([
      'Chiricahua',
      'Grand Canyon',
      'Petrified Forest',
      'Saguaro',
    ]);
    expect(names({ query: 'national park' })).toHaveLength(64);
  });

  it('needs every word to match, and an empty search matches everything', () => {
    expect(matchesQuery(makeSummary(), 'zion utah')).toBe(true);
    expect(matchesQuery(makeSummary(), 'zion alaska')).toBe(false);
    expect(matchesQuery(makeSummary(), '   ')).toBe(true);
    expect(names({ query: 'xyzzy' })).toEqual([]);
  });
});

describe('status filter', () => {
  it('counts the parks that match the search, for each status', () => {
    expect(countByStatus(fixtureSummaries, '')).toEqual({ all: 64, visited: 8, 'not-visited': 56 });
    expect(countByStatus(fixtureSummaries, 'utah')).toEqual({
      all: 5,
      visited: 2,
      'not-visited': 3,
    });
  });

  it('shows visited or not visited parks only', () => {
    expect(names({ status: 'visited' })).toHaveLength(8);
    expect(names({ status: 'not-visited' })).not.toContain('Zion');
  });
});

describe('sort', () => {
  it('sorts by name by default', () => {
    expect(names({}).slice(0, 3)).toEqual(['Acadia', 'American Samoa', 'Arches']);
  });

  it('sorts by rating, best first, with unrated parks last', () => {
    const sorted = names({ sort: 'rating' });
    expect(sorted.slice(0, 2)).toEqual(['Hawaiʻi Volcanoes', 'Zion']);
    expect(sorted.slice(5, 7)).toEqual(['Acadia', 'Virgin Islands']);
    expect(sorted.indexOf('Yosemite')).toBeGreaterThan(6);
  });

  it('sorts by last visit, newest first, with parks never visited last', () => {
    expect(names({ sort: 'last-visited' }).slice(0, 4)).toEqual([
      'Yosemite',
      'Great Smoky Mountains',
      'Hawaiʻi Volcanoes',
      'Zion',
    ]);
    expect(names({ sort: 'last-visited', status: 'visited' }).at(-1)).toBe('Acadia');
  });

  it('sorts by state name, then by name', () => {
    const sorted = names({ sort: 'state' });
    expect(sorted.slice(0, 2)).toEqual(['Denali', 'Gates of the Arctic']);
    expect(summaryOf('denali').stateNames).toBe('Alaska');
  });

  it('sorts by established date, newest first', () => {
    expect(names({ sort: 'established' })[0]).toBe('Chiricahua');
  });

  it('keeps a month-only last visit in date order', () => {
    const parks = [
      makeSummary({ id: 'a', name: 'A', isVisited: true, lastVisit: '2019-10' }),
      makeSummary({ id: 'b', name: 'B', isVisited: true, lastVisit: '2019-09-30' }),
      makeSummary({ id: 'c', name: 'C', isVisited: true, lastVisit: '2019-10-02' }),
    ];
    expect(
      selectParks(parks, { ...DEFAULT_LIST_STATE, sort: 'last-visited' }).map((park) => park.id),
    ).toEqual(['c', 'a', 'b']);
  });
});

describe('value checks', () => {
  it('knows the status and sort values', () => {
    expect(isStatus('visited')).toBe(true);
    expect(isStatus('VISITED')).toBe(false);
    expect(isStatus(null)).toBe(false);
    expect(isSort('rating')).toBe(true);
    expect(isSort('constructor')).toBe(false);
    expect(isSort(null)).toBe(false);
  });
});
