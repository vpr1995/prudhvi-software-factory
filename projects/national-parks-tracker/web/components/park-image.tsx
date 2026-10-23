'use client';

import Image from 'next/image';
import { useCallback, useState } from 'react';

import { joinClassNames } from '../lib/class-names';

import styles from './park-image.module.css';

const SIZES = {
  thumbnail: '96px',
  hero: '(min-width: 960px) 960px, 100vw',
  gallery: '(min-width: 960px) 320px, 50vw',
} as const;

/** One image to try. */
export type ImageSource = {
  readonly src: string;
  readonly alt: string;
};

/** Props of `ParkImage`. */
export type ParkImageProps = {
  /** The images to try, in order. When every image fails, a placeholder shows. */
  readonly sources: readonly ImageSource[];
  /** The accessible text of the placeholder, for example `No photo of Zion`. Thumbnails ignore it. */
  readonly placeholderLabel: string;
  /** `thumbnail` for the list, `hero` for the top of a park page, `gallery` for owner photos. */
  readonly variant: 'thumbnail' | 'hero' | 'gallery';
  /** Called with the index of the image that shows, or -1 for the placeholder. */
  readonly onSourceChange?: (index: number) => void;
};

/**
 * An image in a box with a fixed aspect ratio. When an image fails, the next source shows, and
 * then a styled placeholder.
 *
 * @param props - The sources and the placeholder text.
 * @returns The image or the placeholder.
 */
export function ParkImage(props: ParkImageProps): React.JSX.Element {
  const { sources, placeholderLabel, variant, onSourceChange } = props;
  const [index, setIndex] = useState(0);
  const source = sources[index];
  const showNext = useCallback(() => {
    const next = index + 1;
    setIndex(next);
    onSourceChange?.(next < sources.length ? next : -1);
  }, [index, onSourceChange, sources.length]);
  // An image can fail before React hydrates and adds the error listener. The ref sees that case.
  const checkFailed = useCallback(
    (image: HTMLImageElement | null) => {
      if (
        image !== null &&
        image.complete &&
        image.naturalWidth === 0 &&
        image.getAttribute('src') !== ''
      ) {
        showNext();
      }
    },
    [showNext],
  );
  const boxClass = joinClassNames(styles['box'], styles[variant]);
  if (source === undefined) {
    // A thumbnail is decorative (the row names the park), so its placeholder is hidden too.
    const label =
      variant === 'thumbnail'
        ? { 'aria-hidden': true }
        : { role: 'img', 'aria-label': placeholderLabel };
    return (
      <div className={joinClassNames(boxClass, styles['placeholder'])} {...label}>
        <svg className={styles['icon']} viewBox="0 0 64 40" aria-hidden="true" focusable="false">
          <path d="M2 38 L22 12 L32 24 L42 8 L62 38 Z" />
          <circle cx="50" cy="8" r="4" />
        </svg>
        {variant === 'thumbnail' ? null : (
          <span className={styles['placeholderText']} aria-hidden="true">
            {variant === 'hero' ? 'No photo yet' : 'Photo not found'}
          </span>
        )}
      </div>
    );
  }
  return (
    <div className={boxClass}>
      <Image
        key={source.src}
        ref={checkFailed}
        className={styles['image']}
        src={source.src}
        alt={source.alt}
        fill
        sizes={SIZES[variant]}
        loading={variant === 'hero' ? 'eager' : 'lazy'}
        onError={showNext}
      />
    </div>
  );
}
