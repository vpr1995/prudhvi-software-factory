import Link from 'next/link';

import type { Park } from '../../src/contracts/park.ts';

import styles from './park-pager.module.css';

/** Props of `ParkPager`. */
export type ParkPagerProps = {
  readonly previous: Park | undefined;
  readonly next: Park | undefined;
};

/**
 * Links to the previous and next park (in name order, wrapping around) and back to the map.
 *
 * @param props - The neighbor parks.
 * @returns The navigation.
 */
export function ParkPager(props: ParkPagerProps): React.JSX.Element {
  const { previous, next } = props;
  return (
    <nav className={styles['pager']} aria-label="Park pages">
      {previous === undefined ? null : (
        <Link href={`/parks/${previous.id}/`} className={styles['previous']} rel="prev">
          <span className={styles['direction']}>
            <span aria-hidden="true">← </span>Previous park
          </span>
          <span className={styles['park']}>{previous.name}</span>
        </Link>
      )}
      <Link href="/" className={styles['back']}>
        Back to map
      </Link>
      {next === undefined ? null : (
        <Link href={`/parks/${next.id}/`} className={styles['next']} rel="next">
          <span className={styles['direction']}>
            Next park<span aria-hidden="true"> →</span>
          </span>
          <span className={styles['park']}>{next.name}</span>
        </Link>
      )}
    </nav>
  );
}
