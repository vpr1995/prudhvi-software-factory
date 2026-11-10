// Pure text helpers for the sections. They run while `next build` renders the pages, and in the
// tests. The inputs come from the content contract, so they are already valid.

const MONTH_NAMES = [
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

/** The location block of the content: the primary place, then the other places. */
type Location = {
  readonly primary: string;
  readonly also: readonly string[];
};

/**
 * Writes a `YYYY-MM` month as a short English name and a year, for example `Jan 2020`. The text does
 * not depend on the locale, so the build and the browser show the same words.
 *
 * @param value - A month in the form `YYYY-MM`, checked by the content contract.
 * @returns The month, for example `Jan 2020`.
 * @throws Error when the month number is not 01 to 12.
 */
export function formatMonth(value: string): string {
  const [year = '', month = ''] = value.split('-');
  const name = MONTH_NAMES[Number(month) - 1];
  if (name === undefined) {
    throw new Error(`The month of ${value} is not 01 to 12.`);
  }
  return `${name} ${year}`;
}

/**
 * Writes the period of a role, for example `Jan 2020 – Present`. A role with no end month shows
 * `Present`.
 *
 * @param start - The first month, in the form `YYYY-MM`.
 * @param end - The last month, in the form `YYYY-MM`, or null when the role is current.
 * @returns The period with an en dash between the two parts.
 */
export function formatPeriod(start: string, end: string | null): string {
  const endText = end === null ? 'Present' : formatMonth(end);
  return `${formatMonth(start)} – ${endText}`;
}

/**
 * Writes the location line of the hero. The primary place comes first, then the other places.
 *
 * @param location - The primary place and the other places.
 * @returns The line, for example `Open to relocation: Boston · Bay Area · Seattle · NYC`.
 */
export function formatLocationLine(location: Location): string {
  return `Open to relocation: ${[location.primary, ...location.also].join(' · ')}`;
}

/**
 * Writes an ISO date and time as a short English month and a year, for example `Oct 2026`. The
 * month is read in UTC, so the build and the browser show the same words.
 *
 * @param value - A date and time in ISO form, checked by the feed contract.
 * @returns The month and the year.
 * @throws Error when the text is not a date.
 */
export function formatPublishedMonth(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${value} is not a date.`);
  }
  const name = MONTH_NAMES[date.getUTCMonth()];
  if (name === undefined) {
    throw new Error(`The month of ${value} is not 01 to 12.`);
  }
  return `${name} ${String(date.getUTCFullYear())}`;
}
