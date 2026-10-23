// Builds the map popup with DOM nodes and textContent. Owner text is free text, so the popup
// never uses an HTML string.
import { formatVisitDate } from './dates';
import { getRatingLabel, getRatingStars } from './rating';
import type { ParkSummary } from './search';

const createElement = <TName extends keyof HTMLElementTagNameMap>(
  name: TName,
  className: string,
  text?: string,
): HTMLElementTagNameMap[TName] => {
  const element = document.createElement(name);
  element.className = className;
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
};

/**
 * Gives the visit line of a park, for the popup and the list.
 *
 * @param park - The park.
 * @returns For example `Visited · Last visit May 12, 2023`, or `Not visited yet`.
 */
export function getVisitLine(park: ParkSummary): string {
  if (!park.isVisited) {
    return 'Not visited yet';
  }
  return park.lastVisit === undefined
    ? 'Visited'
    : `Visited · Last visit ${formatVisitDate(park.lastVisit)}`;
}

/**
 * Builds the content of the map popup of a park.
 *
 * @param park - The park.
 * @returns A detached element. Leaflet shows it in the popup.
 */
export function buildPopupContent(park: ParkSummary): HTMLElement {
  const root = createElement('div', 'park-popup');
  root.append(
    createElement('h3', 'park-popup__title', park.name),
    createElement('p', 'park-popup__states', park.stateNames),
    createElement(
      'p',
      `park-popup__status ${park.isVisited ? 'park-popup__status--visited' : ''}`.trim(),
      getVisitLine(park),
    ),
  );
  if (park.rating !== undefined) {
    const rating = createElement('p', 'park-popup__rating', getRatingStars(park.rating));
    rating.setAttribute('role', 'img');
    rating.setAttribute('aria-label', getRatingLabel(park.rating));
    root.append(rating);
  }
  const link = createElement('a', 'park-popup__link', 'View park');
  link.href = `/parks/${park.id}/`;
  root.append(link);
  return root;
}
