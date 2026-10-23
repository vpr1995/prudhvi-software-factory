import type { ParkSummary } from './search';

/** The numbers in the header. */
export type VisitStats = {
  readonly visitedCount: number;
  readonly totalCount: number;
  readonly statesVisited: number;
  readonly tripCount: number;
  /** The park with the newest trip, and the start of that trip. */
  readonly latestVisit:
    { readonly parkId: string; readonly parkName: string; readonly date: string } | undefined;
};

const sortKey = (date: string): string => (date.length > 'YYYY-MM'.length ? date : `${date}-01`);

/**
 * Computes the header numbers.
 *
 * @param parks - Every park.
 * @returns The stats.
 */
export function computeStats(parks: readonly ParkSummary[]): VisitStats {
  const visited = parks.filter((park) => park.isVisited);
  const states = new Set(visited.flatMap((park) => park.states));
  let latestVisit: VisitStats['latestVisit'];
  for (const park of visited) {
    const date = park.lastVisit;
    if (
      date !== undefined &&
      (latestVisit === undefined || sortKey(date) > sortKey(latestVisit.date))
    ) {
      latestVisit = { parkId: park.id, parkName: park.name, date };
    }
  }
  return {
    visitedCount: visited.length,
    totalCount: parks.length,
    statesVisited: states.size,
    tripCount: visited.reduce((sum, park) => sum + park.tripCount, 0),
    latestVisit,
  };
}
