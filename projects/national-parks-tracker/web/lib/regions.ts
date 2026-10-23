import type { StateCode } from '../../src/contracts/park.ts';

/** The map regions. Each has a button that moves the map to it. */
export const REGIONS = ['lower48', 'alaska', 'hawaii', 'american-samoa', 'virgin-islands'] as const;

/** A map region. */
export type Region = (typeof REGIONS)[number];

/** A map view: one region, or every park. */
export type MapView = Region | 'all';

/** The button text of each view. */
export const VIEW_LABELS: Readonly<Record<MapView, string>> = {
  lower48: 'Lower 48',
  alaska: 'Alaska',
  hawaii: 'Hawaii',
  'american-samoa': 'American Samoa',
  'virgin-islands': 'Virgin Islands',
  all: 'All parks',
};

/** South-west and north-east corners, `[lat, lng]`. */
export type Bounds = readonly [readonly [number, number], readonly [number, number]];

// The corners of the lower 48: the Florida Keys in the south west, Maine in the north east.
const LOWER_48_SOUTH = 24.4;
const LOWER_48_WEST = -124.8;
const LOWER_48_NORTH = 49.4;
const LOWER_48_EAST = -66.9;

/** The lower 48 states. The first view of the map. */
export const LOWER_48_BOUNDS: Bounds = [
  [LOWER_48_SOUTH, LOWER_48_WEST],
  [LOWER_48_NORTH, LOWER_48_EAST],
];

const REGION_BY_STATE: Partial<Record<StateCode, Region>> = {
  AK: 'alaska',
  HI: 'hawaii',
  AS: 'american-samoa',
  VI: 'virgin-islands',
};

/**
 * Finds the map region of a park from its first state.
 *
 * @param states - The state codes of the park.
 * @returns The region.
 */
export function getRegion(states: readonly StateCode[]): Region {
  const [first] = states;
  return (first === undefined ? undefined : REGION_BY_STATE[first]) ?? 'lower48';
}

/** Where the map goes for a view: a box to fit, or a point and a zoom for a single park. */
export type ViewTarget =
  | { readonly kind: 'bounds'; readonly bounds: Bounds }
  | { readonly kind: 'point'; readonly lat: number; readonly lng: number; readonly zoom: number };

/** The zoom for a region with one park. */
export const SINGLE_PARK_ZOOM = 9;

/** A map position. */
export type LatLng = { readonly lat: number; readonly lng: number };

/**
 * Finds where the map goes for a view.
 *
 * @param view - The view.
 * @param parks - Every park, with its region.
 * @returns The target. The lower 48 always use the fixed box.
 */
export function getViewTarget(
  view: MapView,
  parks: readonly (LatLng & { readonly region: Region })[],
): ViewTarget {
  if (view === 'lower48') {
    return { kind: 'bounds', bounds: LOWER_48_BOUNDS };
  }
  const points = view === 'all' ? parks : parks.filter((park) => park.region === view);
  const [first] = points;
  if (first === undefined) {
    return { kind: 'bounds', bounds: LOWER_48_BOUNDS };
  }
  if (points.length === 1) {
    return { kind: 'point', lat: first.lat, lng: first.lng, zoom: SINGLE_PARK_ZOOM };
  }
  const lats = points.map((point) => point.lat);
  const lngs = points.map((point) => point.lng);
  return {
    kind: 'bounds',
    bounds: [
      [Math.min(...lats), Math.min(...lngs)],
      [Math.max(...lats), Math.max(...lngs)],
    ],
  };
}

/**
 * Tells whether a point is inside a box.
 *
 * @param bounds - The box.
 * @param point - The point.
 * @returns True when the point is inside or on the edge.
 */
export function containsPoint(bounds: Bounds, point: LatLng): boolean {
  const [[south, west], [north, east]] = bounds;
  return point.lat >= south && point.lat <= north && point.lng >= west && point.lng <= east;
}

/** How many parks are outside the map view, in total and for each region. */
export type OutsideCounts = {
  readonly total: number;
  readonly byRegion: Readonly<Record<Region, number>>;
};

/**
 * Counts the parks outside a map view.
 *
 * @param bounds - The visible box.
 * @param parks - The parks on the map.
 * @returns The counts.
 */
export function countOutside(
  bounds: Bounds,
  parks: readonly (LatLng & { readonly region: Region })[],
): OutsideCounts {
  const byRegion: Record<Region, number> = {
    lower48: 0,
    alaska: 0,
    hawaii: 0,
    'american-samoa': 0,
    'virgin-islands': 0,
  };
  let total = 0;
  for (const park of parks) {
    if (!containsPoint(bounds, park)) {
      byRegion[park.region] += 1;
      total += 1;
    }
  }
  return { total, byRegion };
}
