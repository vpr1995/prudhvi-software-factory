'use client';

import Link from 'next/link';

import { joinClassNames } from '../lib/class-names';
import { formatVisitDate } from '../lib/dates';
import type { ParkSummary } from '../lib/search';

import { ParkImage } from './park-image';
import styles from './park-row.module.css';
import { RatingStars } from './rating-stars';

/** Props of `ParkRow`. */
export type ParkRowProps = {
  readonly park: ParkSummary;
  readonly isSelected: boolean;
  readonly onShowOnMap: (id: string) => void;
};

/**
 * One park in the list: photo, name, states, visit status, rating and a "Show on map" button.
 *
 * @param props - The park and the callback.
 * @returns The list item.
 */
export function ParkRow(props: ParkRowProps): React.JSX.Element {
  const { park, isSelected, onShowOnMap } = props;
  return (
    <li
      className={styles['row']}
      data-selected={isSelected}
      aria-current={isSelected ? 'true' : undefined}
    >
      <ParkImage
        variant="thumbnail"
        placeholderLabel={park.name}
        sources={park.thumbnail === undefined ? [] : [{ src: park.thumbnail.src, alt: '' }]}
      />
      <div className={styles['body']}>
        <h3 className={styles['name']}>
          <Link href={`/parks/${park.id}/`}>{park.name}</Link>
        </h3>
        <p className={styles['states']}>{park.stateNames}</p>
        <p className={styles['meta']}>
          {park.isVisited ? (
            <span className={joinClassNames(styles['badge'], styles['visited'])}>
              <span aria-hidden="true">✓ </span>Visited
              {park.lastVisit === undefined ? null : (
                <span className={styles['date']}> · {formatVisitDate(park.lastVisit)}</span>
              )}
            </span>
          ) : (
            <span className={joinClassNames(styles['badge'], styles['notVisited'])}>Not yet</span>
          )}
          {park.rating === undefined ? null : <RatingStars rating={park.rating} />}
        </p>
      </div>
      <button
        type="button"
        className={styles['show']}
        onClick={() => {
          onShowOnMap(park.id);
        }}
      >
        Show <span className="visually-hidden">{park.name}</span> on map
      </button>
    </li>
  );
}
