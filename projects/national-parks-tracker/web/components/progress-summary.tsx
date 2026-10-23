import Link from 'next/link';

import { formatVisitDate } from '../lib/dates';
import type { VisitStats } from '../lib/stats';

import styles from './progress-summary.module.css';

/** Props of `ProgressSummary`. */
export type ProgressSummaryProps = {
  readonly stats: VisitStats;
};

/**
 * Shows how many parks are visited, with a progress bar and small stats.
 *
 * @param props - The stats.
 * @returns The summary.
 */
export function ProgressSummary(props: ProgressSummaryProps): React.JSX.Element {
  const { stats } = props;
  const { latestVisit } = stats;
  return (
    <div className={styles['summary']}>
      <div className={styles['progress']}>
        <p id="progress-label" className={styles['label']}>
          <strong>{stats.visitedCount}</strong> of {stats.totalCount} parks visited
        </p>
        <progress
          className={styles['bar']}
          aria-labelledby="progress-label"
          value={stats.visitedCount}
          max={stats.totalCount}
        />
      </div>
      <dl className={styles['stats']}>
        <div>
          <dt>States visited</dt>
          <dd>{stats.statesVisited}</dd>
        </div>
        <div>
          <dt>Trips</dt>
          <dd>{stats.tripCount}</dd>
        </div>
        <div>
          <dt>Latest visit</dt>
          <dd>
            {latestVisit === undefined ? (
              'None yet'
            ) : (
              <>
                <Link href={`/parks/${latestVisit.parkId}/`}>{latestVisit.parkName}</Link>
                {' · '}
                {formatVisitDate(latestVisit.date)}
              </>
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}
