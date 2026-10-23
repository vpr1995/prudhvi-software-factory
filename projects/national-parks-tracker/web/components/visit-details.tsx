import type { Visit } from '../../src/contracts/visit.ts';
import { formatTripRange, sortTripsNewestFirst } from '../lib/dates';

import { ParkImage } from './park-image';
import { RatingStars } from './rating-stars';
import styles from './visit-details.module.css';

/** Props of `VisitDetails`. */
export type VisitDetailsProps = {
  readonly parkName: string;
  readonly visit: Visit | undefined;
};

/**
 * Shows the free-text notes. Line breaks in the text stay.
 *
 * @param props - The heading and the text.
 * @returns The note, or nothing when there is no text.
 */
function Note(props: {
  readonly title: string;
  readonly text: string | undefined;
}): React.JSX.Element | null {
  if (props.text === undefined) {
    return null;
  }
  return (
    <section className={styles['note']}>
      <h3>{props.title}</h3>
      <p className={styles['text']}>{props.text}</p>
    </section>
  );
}

/**
 * The owner photos with captions.
 *
 * @param props - The photos.
 * @returns The gallery, or nothing when there are no photos.
 */
function Gallery(props: { readonly photos: Visit['photos'] }): React.JSX.Element | null {
  const { photos } = props;
  if (photos === undefined || photos.length === 0) {
    return null;
  }
  return (
    <section className={styles['note']}>
      <h3>Our photos</h3>
      <ul className={styles['gallery']}>
        {photos.map((photo) => (
          <li key={photo.src}>
            <figure className={styles['figure']}>
              <ParkImage
                variant="gallery"
                sources={[{ src: photo.src, alt: photo.alt }]}
                placeholderLabel={`Photo not found: ${photo.alt}`}
              />
              {photo.caption === undefined ? null : <figcaption>{photo.caption}</figcaption>}
            </figure>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The visit part of a park page: trips, rating, notes, places and photos. A park with no visit
 * shows a "Not visited yet" card. A missing field is left out.
 *
 * @param props - The park name and the visit.
 * @returns The section content.
 */
export function VisitDetails(props: VisitDetailsProps): React.JSX.Element {
  const { parkName, visit } = props;
  if (visit === undefined) {
    return (
      <div className={styles['notVisited']}>
        <p className={styles['notVisitedTitle']}>Not visited yet</p>
        <p>{parkName} is still on the list. When we go, our trips and notes will show here.</p>
      </div>
    );
  }
  const trips = sortTripsNewestFirst(visit.trips);
  return (
    <div className={styles['visit']}>
      <div className={styles['summary']}>
        <span className={styles['badge']}>
          <span aria-hidden="true">✓ </span>Visited
        </span>
        <span>
          {trips.length} {trips.length === 1 ? 'trip' : 'trips'}
        </span>
        {visit.rating === undefined ? null : <RatingStars rating={visit.rating} size="large" />}
      </div>
      <section className={styles['note']}>
        <h3>Trips</h3>
        <ol className={styles['trips']} aria-label="Trips, newest first">
          {trips.map((trip) => (
            <li key={`${trip.start}-${trip.end ?? ''}`}>{formatTripRange(trip)}</li>
          ))}
        </ol>
      </section>
      <Note title="What we liked" text={visit.liked} />
      <Note title="What we did" text={visit.did} />
      {visit.placesToGo === undefined || visit.placesToGo.length === 0 ? null : (
        <section className={styles['note']}>
          <h3>Places to go</h3>
          <ul className={styles['places']}>
            {visit.placesToGo.map((place) => (
              <li key={place}>{place}</li>
            ))}
          </ul>
        </section>
      )}
      <Gallery photos={visit.photos} />
    </div>
  );
}
