import type { Park, ParkPhoto } from '../../src/contracts/park.ts';
import type { Trip, Visit } from '../../src/contracts/visit.ts';

import { sortTripsNewestFirst } from './dates';
import { getRegion } from './regions';
import type { ParkSummary } from './search';
import type { SiteData } from './site-data';
import { formatStateNames } from './states';

const SQUARE_KM_PER_ACRE = 0.004_046_856_422_4;
const COORDINATE_DIGITS = 2;
const NUMBER_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const AREA_KM_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

/**
 * Gives the newest trip of a visit.
 *
 * @param visit - The visit, or undefined for a park with no visit.
 * @returns The newest trip, or undefined.
 */
export function getLatestTrip(visit: Visit | undefined): Trip | undefined {
  return visit === undefined ? undefined : sortTripsNewestFirst(visit.trips)[0];
}

/**
 * Builds the plain data that the list and the map show for one park.
 *
 * @param park - The park.
 * @param visit - The visit, if any.
 * @param photo - The Wikimedia photo, if any.
 * @returns The summary.
 */
export function buildParkSummary(
  park: Park,
  visit: Visit | undefined,
  photo: ParkPhoto | undefined,
): ParkSummary {
  return {
    id: park.id,
    name: park.name,
    fullName: park.fullName,
    states: park.states,
    stateNames: formatStateNames(park.states),
    lat: park.coordinates.lat,
    lng: park.coordinates.lng,
    region: getRegion(park.states),
    established: park.established,
    isVisited: visit !== undefined,
    lastVisit: getLatestTrip(visit)?.start,
    tripCount: visit?.trips.length ?? 0,
    rating: visit?.rating,
    thumbnail:
      photo === undefined
        ? undefined
        : { src: photo.thumbSrc, width: photo.width, height: photo.height },
  };
}

/**
 * Builds the summaries of every park, sorted by name.
 *
 * @param data - The site data.
 * @returns One summary for each park.
 */
export function buildParkSummaries(data: SiteData): ParkSummary[] {
  return data.parks.map((park) =>
    buildParkSummary(park, data.visits[park.id], data.photos[park.id]),
  );
}

/**
 * Finds the parks before and after a park in name order. The ends wrap around.
 *
 * @param parks - Every park, sorted by name.
 * @param id - The park id.
 * @returns The previous and the next park.
 */
export function getNeighbors(
  parks: readonly Park[],
  id: string,
): { readonly previous: Park | undefined; readonly next: Park | undefined } {
  const index = parks.findIndex((park) => park.id === id);
  if (index === -1 || parks.length <= 1) {
    return { previous: undefined, next: undefined };
  }
  return {
    previous: parks.at(index - 1),
    next: parks.at((index + 1) % parks.length),
  };
}

/**
 * Formats an area in acres and square kilometers.
 *
 * @param acres - The area in acres.
 * @returns For example `49,071 acres (198.6 km²)`.
 */
export function formatArea(acres: number): string {
  return `${NUMBER_FORMAT.format(acres)} acres (${AREA_KM_FORMAT.format(acres * SQUARE_KM_PER_ACRE)} km²)`;
}

/**
 * Formats a map position.
 *
 * @param lat - Latitude in decimal degrees.
 * @param lng - Longitude in decimal degrees.
 * @returns For example `44.35° N, 68.21° W`.
 */
export function formatCoordinates(lat: number, lng: number): string {
  const latitude = `${Math.abs(lat).toFixed(COORDINATE_DIGITS)}° ${lat < 0 ? 'S' : 'N'}`;
  const longitude = `${Math.abs(lng).toFixed(COORDINATE_DIGITS)}° ${lng < 0 ? 'W' : 'E'}`;
  return `${latitude}, ${longitude}`;
}

/**
 * Builds the link to the park page on nps.gov.
 *
 * @param npsCode - The nps.gov site code.
 * @returns For example `https://www.nps.gov/zion/`.
 */
export function getNpsUrl(npsCode: string): string {
  return `https://www.nps.gov/${npsCode}/`;
}
