// Visit and park dates are calendar dates without a time zone. `new Date('2024-07-04')` is
// midnight UTC, which is July 3 in US time zones. So this module never builds a local Date: it
// reads the parts of the text and formats them with fixed English month names.
import type { Trip } from '../../src/contracts/visit.ts';

const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const LONG_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** The parts of a `YYYY-MM-DD` or `YYYY-MM` date. `day` is undefined for a month-only date. */
export type DateParts = {
  readonly year: number;
  readonly month: number;
  readonly day: number | undefined;
};

/**
 * Reads the parts of a date text. The text is already checked by the contracts.
 *
 * @param value - `YYYY-MM-DD` or `YYYY-MM`.
 * @returns The year, the month (1 to 12) and the day.
 */
export function parseDateParts(value: string): DateParts {
  const [year = 0, month = 1, day] = value.split('-').map(Number);
  return { year, month, day };
}

const shortMonth = (month: number): string => SHORT_MONTHS[month - 1] ?? '';

/**
 * Formats a visit date.
 *
 * @param value - `YYYY-MM-DD` or `YYYY-MM`.
 * @returns For example `May 12, 2023` or `Oct 2019`.
 */
export function formatVisitDate(value: string): string {
  const { year, month, day } = parseDateParts(value);
  const monthName = shortMonth(month);
  return day === undefined ? `${monthName} ${year}` : `${monthName} ${day}, ${year}`;
}

/**
 * Formats a date in long form, for the park facts.
 *
 * @param value - `YYYY-MM-DD`.
 * @returns For example `February 26, 1919`.
 */
export function formatLongDate(value: string): string {
  const { year, month, day } = parseDateParts(value);
  const monthName = LONG_MONTHS[month - 1] ?? '';
  return day === undefined ? `${monthName} ${year}` : `${monthName} ${day}, ${year}`;
}

/**
 * Formats the date range of a trip. The shared parts are written once.
 *
 * @param trip - The trip.
 * @returns For example `May 12–15, 2023`, `Jun 30 – Jul 2, 2023`, `Dec 30, 2022 – Jan 2, 2023` or `Oct 2019`.
 */
export function formatTripRange(trip: Trip): string {
  const { start, end } = trip;
  if (end === undefined || end === start) {
    return formatVisitDate(start);
  }
  const from = parseDateParts(start);
  const to = parseDateParts(end);
  if (from.day === undefined || to.day === undefined) {
    return from.year === to.year && from.day === undefined && to.day === undefined
      ? `${shortMonth(from.month)} – ${shortMonth(to.month)} ${to.year}`
      : `${formatVisitDate(start)} – ${formatVisitDate(end)}`;
  }
  if (from.year !== to.year) {
    return `${formatVisitDate(start)} – ${formatVisitDate(end)}`;
  }
  if (from.month !== to.month) {
    return `${shortMonth(from.month)} ${from.day} – ${shortMonth(to.month)} ${to.day}, ${to.year}`;
  }
  return `${shortMonth(from.month)} ${from.day}–${to.day}, ${to.year}`;
}

/**
 * Gives a sort key for a date text. A month-only date sorts as the first day of its month.
 *
 * @param value - `YYYY-MM-DD` or `YYYY-MM`.
 * @returns A `YYYY-MM-DD` text that sorts in date order.
 */
export function toSortKey(value: string): string {
  return parseDateParts(value).day === undefined ? `${value}-01` : value;
}

/**
 * Sorts trips with the newest first. A trip that ends later comes first when two start on the same day.
 *
 * @param trips - The trips, in any order.
 * @returns A new array, newest first.
 */
export function sortTripsNewestFirst(trips: readonly Trip[]): Trip[] {
  const lastDay = (trip: Trip): string => toSortKey(trip.end ?? trip.start);
  return trips.toSorted(
    (left, right) =>
      toSortKey(right.start).localeCompare(toSortKey(left.start)) ||
      lastDay(right).localeCompare(lastDay(left)),
  );
}
