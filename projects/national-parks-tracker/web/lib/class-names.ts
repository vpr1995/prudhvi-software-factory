/**
 * Joins CSS class names. Empty, false and undefined parts are left out.
 *
 * @param names - The class names.
 * @returns The `className` text.
 */
export function joinClassNames(...names: readonly (string | false | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}
