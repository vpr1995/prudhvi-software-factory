import type { StateCode } from '../../src/contracts/park.ts';

import type { Region } from './regions';

/** A park as the list and the map show it. The server builds it, so it is plain data. */
export type ParkSummary = {
  readonly id: string;
  readonly name: string;
  readonly fullName: string;
  /** State codes, for example `['CA', 'NV']`. */
  readonly states: readonly StateCode[];
  /** Full state names, for example `California, Nevada`. */
  readonly stateNames: string;
  readonly lat: number;
  readonly lng: number;
  readonly region: Region;
  /** `YYYY-MM-DD`. */
  readonly established: string;
  readonly isVisited: boolean;
  /** The start of the newest trip, `YYYY-MM-DD` or `YYYY-MM`. */
  readonly lastVisit: string | undefined;
  readonly tripCount: number;
  readonly rating: number | undefined;
  readonly thumbnail:
    { readonly src: string; readonly width: number; readonly height: number } | undefined;
};

/** The status filter values. */
export const STATUSES = ['all', 'visited', 'not-visited'] as const;

/** A status filter value. */
export type Status = (typeof STATUSES)[number];

/** The sort orders. */
export const SORTS = ['name', 'state', 'established', 'last-visited', 'rating'] as const;

/** A sort order. */
export type Sort = (typeof SORTS)[number];

const STATUS_SET: ReadonlySet<string> = new Set(STATUSES);
const SORT_SET: ReadonlySet<string> = new Set(SORTS);

/**
 * Checks a status filter value from the URL or a form control.
 *
 * @param value - The value to check.
 * @returns True when the value is a known status filter.
 */
export const isStatus = (value: string | null): value is Status =>
  value !== null && STATUS_SET.has(value);

/**
 * Checks a sort order from the URL or a form control.
 *
 * @param value - The value to check.
 * @returns True when the value is a known sort order.
 */
export const isSort = (value: string | null): value is Sort =>
  value !== null && SORT_SET.has(value);

/** The state of the list: search text, status filter and sort order. */
export type ListState = {
  readonly query: string;
  readonly status: Status;
  readonly sort: Sort;
};

/** The list state with no filter. */
export const DEFAULT_LIST_STATE: ListState = { query: '', status: 'all', sort: 'name' };

// Hawaiian ʻokina, apostrophes and other marks that people leave out when they type.
const IGNORED_MARKS = /[ʻʼ‘’'`]/g;
const COMBINING_MARKS = /\p{Mark}/gu;
const DASHES = /[‐-―-]/g;
const SPACES = /\s+/g;

/**
 * Normalizes text for search: lowercase, no accents, no ʻokina or apostrophes, single spaces.
 *
 * @param text - Any text.
 * @returns For example `hawaii volcanoes` for `Hawaiʻi Volcanoes`.
 */
export function normalizeSearchText(text: string): string {
  return text
    .normalize('NFD')
    .replaceAll(COMBINING_MARKS, '')
    .replaceAll(IGNORED_MARKS, '')
    .replaceAll(DASHES, ' ')
    .toLowerCase()
    .replaceAll(SPACES, ' ')
    .trim();
}

/**
 * Builds the text that a search looks in: the names and the state codes and names.
 *
 * @param park - The park.
 * @returns Normalized text.
 */
export function getSearchText(park: ParkSummary): string {
  return normalizeSearchText([park.name, park.fullName, ...park.states, park.stateNames].join(' '));
}

/**
 * Tells whether a park matches a search. Every word of the search must appear.
 *
 * @param park - The park.
 * @param query - The search text, as typed.
 * @returns True when the park matches. An empty search matches every park.
 */
export function matchesQuery(park: ParkSummary, query: string): boolean {
  const words = normalizeSearchText(query).split(' ').filter(Boolean);
  if (words.length === 0) {
    return true;
  }
  const haystack = ` ${getSearchText(park)} `;
  return words.every((word) => haystack.includes(word));
}

/**
 * Tells whether a park passes the status filter.
 *
 * @param park - The park.
 * @param status - The filter.
 * @returns True when the park passes.
 */
export function matchesStatus(park: ParkSummary, status: Status): boolean {
  if (status === 'all') {
    return true;
  }
  return status === 'visited' ? park.isVisited : !park.isVisited;
}

/** How many parks match the search for each status. */
export type StatusCounts = Readonly<Record<Status, number>>;

/**
 * Counts the parks that match the search, for each status.
 *
 * @param parks - Every park.
 * @param query - The search text.
 * @returns The counts.
 */
export function countByStatus(parks: readonly ParkSummary[], query: string): StatusCounts {
  const matching = parks.filter((park) => matchesQuery(park, query));
  const visited = matching.filter((park) => park.isVisited).length;
  return { all: matching.length, visited, 'not-visited': matching.length - visited };
}

const byName = (left: ParkSummary, right: ParkSummary): number =>
  left.name.localeCompare(right.name, 'en');

// Missing values sort last in every order.
const compareMissingLast = <TValue>(
  left: TValue | undefined,
  right: TValue | undefined,
  compare: (a: TValue, b: TValue) => number,
): number => {
  if (left === undefined || right === undefined) {
    return Number(left === undefined) - Number(right === undefined);
  }
  return compare(left, right);
};

const visitKey = (park: ParkSummary): string | undefined =>
  park.lastVisit === undefined || park.lastVisit.length > 'YYYY-MM'.length
    ? park.lastVisit
    : `${park.lastVisit}-01`;

const COMPARATORS: Readonly<Record<Sort, (left: ParkSummary, right: ParkSummary) => number>> = {
  name: byName,
  state: (left, right) =>
    left.stateNames.localeCompare(right.stateNames, 'en') || byName(left, right),
  established: (left, right) =>
    right.established.localeCompare(left.established) || byName(left, right),
  'last-visited': (left, right) =>
    compareMissingLast(visitKey(left), visitKey(right), (a, b) => b.localeCompare(a)) ||
    byName(left, right),
  rating: (left, right) =>
    compareMissingLast(left.rating, right.rating, (a, b) => b - a) || byName(left, right),
};

/**
 * Filters and sorts the parks for the list.
 *
 * @param parks - Every park.
 * @param state - The list state.
 * @returns The parks to show, in order.
 */
export function selectParks(parks: readonly ParkSummary[], state: ListState): ParkSummary[] {
  return parks
    .filter((park) => matchesQuery(park, state.query) && matchesStatus(park, state.status))
    .toSorted(COMPARATORS[state.sort]);
}
