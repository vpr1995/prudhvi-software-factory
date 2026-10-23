'use client';

import { useState } from 'react';

import type { ParkPhoto } from '../../src/contracts/park.ts';
import type { VisitPhoto } from '../../src/contracts/visit.ts';

import styles from './park-hero.module.css';
import { ParkImage } from './park-image';
import type { ImageSource } from './park-image';

/** Props of `ParkHero`. */
export type ParkHeroProps = {
  readonly parkName: string;
  /** The Wikimedia Commons photo. It shows first. */
  readonly photo: ParkPhoto | undefined;
  /** The first photo of the owner. It shows when the Wikimedia photo is missing or fails. */
  readonly ownerPhoto: VisitPhoto | undefined;
};

/**
 * The big photo of a park page with its credit line. Wikimedia photo first, then the owner photo,
 * then a placeholder.
 *
 * @param props - The photos.
 * @returns The figure.
 */
export function ParkHero(props: ParkHeroProps): React.JSX.Element {
  const { parkName, photo, ownerPhoto } = props;
  const sources: ImageSource[] = [];
  if (photo !== undefined) {
    sources.push({ src: photo.src, alt: photo.alt });
  }
  if (ownerPhoto !== undefined) {
    sources.push({ src: ownerPhoto.src, alt: ownerPhoto.alt });
  }
  const [shownIndex, setShownIndex] = useState(sources.length === 0 ? -1 : 0);
  const isWikimedia = photo !== undefined && shownIndex === 0;
  const isOwner = ownerPhoto !== undefined && shownIndex === sources.length - 1 && !isWikimedia;
  return (
    <figure className={styles['hero']}>
      <ParkImage
        variant="hero"
        sources={sources}
        placeholderLabel={parkName}
        onSourceChange={setShownIndex}
      />
      {isWikimedia ? (
        <figcaption className={styles['credit']}>
          Photo:{' '}
          <a href={photo.sourceUrl} title={photo.credit}>
            {photo.credit}
          </a>{' '}
          ·{' '}
          {photo.licenseUrl === undefined ? (
            photo.license
          ) : (
            <a href={photo.licenseUrl}>{photo.license}</a>
          )}
        </figcaption>
      ) : null}
      {isOwner && ownerPhoto.caption !== undefined ? (
        <figcaption className={styles['credit']}>{ownerPhoto.caption}</figcaption>
      ) : null}
    </figure>
  );
}
