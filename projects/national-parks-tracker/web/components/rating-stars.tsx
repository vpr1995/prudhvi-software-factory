import { joinClassNames } from '../lib/class-names';
import { getRatingLabel, getRatingStars } from '../lib/rating';

import styles from './rating-stars.module.css';

/** Props of `RatingStars`. */
export type RatingStarsProps = {
  /** 1 to 5. */
  readonly rating: number;
  readonly size?: 'small' | 'large';
};

/**
 * Shows a rating as stars. Screen readers read "Rated 4 out of 5".
 *
 * @param props - The rating.
 * @returns The stars.
 */
export function RatingStars(props: RatingStarsProps): React.JSX.Element {
  const { rating, size = 'small' } = props;
  return (
    <span
      role="img"
      aria-label={getRatingLabel(rating)}
      className={joinClassNames(styles['stars'], size === 'large' && styles['large'])}
    >
      {getRatingStars(rating)}
    </span>
  );
}
