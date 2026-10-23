import type { Park } from '../../src/contracts/park.ts';
import { formatLongDate } from '../lib/dates';
import { formatArea, formatCoordinates, getNpsUrl } from '../lib/park-view';
import { formatStateNames } from '../lib/states';

import styles from './park-facts.module.css';

/** Props of `ParkFacts`. */
export type ParkFactsProps = {
  readonly park: Park;
};

/**
 * The facts of a park: names, states, date, area, position and the nps.gov link.
 *
 * @param props - The park.
 * @returns The fact list.
 */
export function ParkFacts(props: ParkFactsProps): React.JSX.Element {
  const { park } = props;
  return (
    <dl className={styles['facts']}>
      <div>
        <dt>Full name</dt>
        <dd>{park.fullName}</dd>
      </div>
      <div>
        <dt>{park.states.length === 1 ? 'State' : 'States'}</dt>
        <dd>{formatStateNames(park.states)}</dd>
      </div>
      <div>
        <dt>Established</dt>
        <dd>{formatLongDate(park.established)}</dd>
      </div>
      <div>
        <dt>Area</dt>
        <dd>{formatArea(park.areaAcres)}</dd>
      </div>
      <div>
        <dt>Coordinates</dt>
        <dd>{formatCoordinates(park.coordinates.lat, park.coordinates.lng)}</dd>
      </div>
      <div>
        <dt>Official site</dt>
        <dd>
          <a href={getNpsUrl(park.npsCode)} target="_blank" rel="noopener noreferrer">
            {park.name} on nps.gov <span className="visually-hidden">(opens in a new tab)</span>
            <span aria-hidden="true"> ↗</span>
          </a>
        </dd>
      </div>
    </dl>
  );
}
