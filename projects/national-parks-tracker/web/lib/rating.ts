/** The highest rating. */
export const MAX_RATING = 5;

/**
 * Gives the accessible text of a rating.
 *
 * @param rating - 1 to 5.
 * @returns For example `Rated 4 out of 5`.
 */
export function getRatingLabel(rating: number): string {
  return `Rated ${String(rating)} out of ${String(MAX_RATING)}`;
}

/**
 * Draws a rating with stars, for sighted readers. Pair it with `getRatingLabel`.
 *
 * @param rating - 1 to 5.
 * @returns For example `★★★★☆`.
 */
export function getRatingStars(rating: number): string {
  const filled = Math.max(0, Math.min(MAX_RATING, Math.round(rating)));
  return `${'★'.repeat(filled)}${'☆'.repeat(MAX_RATING - filled)}`;
}
