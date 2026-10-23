'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';

import { joinClassNames } from '../lib/class-names';
import { REGIONS, VIEW_LABELS } from '../lib/regions';
import type { MapView, OutsideCounts, Region } from '../lib/regions';
import type { ParkSummary } from '../lib/search';

import styles from './map-panel.module.css';
import type { ParkMapProps, Selection, SelectionSource, ViewRequest } from './park-map';

const VIEWS: readonly MapView[] = [...REGIONS, 'all'];

/**
 * The text that shows while the map code loads.
 *
 * @returns The loading text.
 */
function MapLoading(): React.JSX.Element {
  return <p className={styles['loading']}>Loading the map…</p>;
}

// Leaflet touches `window` when it loads, so the map renders in the browser only.
const ParkMap = dynamic<ParkMapProps>(
  async () => {
    const mapModule = await import('./park-map');
    return mapModule.ParkMap;
  },
  { ssr: false, loading: MapLoading },
);

/** Props of `MapPanel`. */
export type MapPanelProps = {
  readonly parks: readonly ParkSummary[];
  readonly allParks: readonly ParkSummary[];
  readonly selection: Selection | undefined;
  readonly viewRequest: ViewRequest;
  readonly onViewChange: (view: MapView) => void;
  readonly onSelect: (id: string, source: SelectionSource) => void;
};

/**
 * Tells how many parks are outside the view, with a button for each region that has some.
 *
 * @param props - The counts and the view callback.
 * @returns The note, or nothing when every park is in view.
 */
function OutsideNote(props: {
  readonly counts: OutsideCounts;
  readonly onViewChange: (view: MapView) => void;
}): React.JSX.Element | null {
  const { counts, onViewChange } = props;
  if (counts.total === 0) {
    return null;
  }
  const regions = REGIONS.filter((region: Region) => counts.byRegion[region] > 0);
  return (
    <div className={styles['outside']}>
      <span>
        +{counts.total} {counts.total === 1 ? 'park' : 'parks'} outside this view:
      </span>
      {regions.map((region) => (
        <button
          key={region}
          type="button"
          className={styles['jump']}
          onClick={() => {
            onViewChange(region);
          }}
        >
          {VIEW_LABELS[region]} ({counts.byRegion[region]})
        </button>
      ))}
    </div>
  );
}

/**
 * The legend: shape and color both tell visited from not visited.
 *
 * @returns The legend.
 */
function Legend(): React.JSX.Element {
  return (
    <ul className={styles['legend']} aria-label="Map legend">
      <li>
        <span
          className={joinClassNames(styles['swatch'], styles['swatchVisited'])}
          aria-hidden="true"
        >
          ✓
        </span>
        Visited
      </li>
      <li>
        <span
          className={joinClassNames(styles['swatch'], styles['swatchNotVisited'])}
          aria-hidden="true"
        />
        Not visited yet
      </li>
      <li>
        <span
          className={joinClassNames(styles['swatch'], styles['swatchSelected'])}
          aria-hidden="true"
        />
        Selected
      </li>
    </ul>
  );
}

/**
 * The map part of the home page: view buttons, the Leaflet map, the legend and notes.
 *
 * @param props - The parks, the selection and the callbacks.
 * @returns The map section.
 */
export function MapPanel(props: MapPanelProps): React.JSX.Element {
  const { parks, allParks, selection, viewRequest, onViewChange, onSelect } = props;
  const [hasTileError, setHasTileError] = useState(false);
  // The token of the view request that the map left. A region button shows pressed only while the
  // map shows the view of the last request.
  const [leftViewToken, setLeftViewToken] = useState<number | undefined>(undefined);
  const isViewShown = leftViewToken !== viewRequest.token;
  const [outside, setOutside] = useState<OutsideCounts>({
    total: 0,
    byRegion: { lower48: 0, alaska: 0, hawaii: 0, 'american-samoa': 0, 'virgin-islands': 0 },
  });
  return (
    <>
      <div className={styles['views']} role="group" aria-label="Map view">
        {VIEWS.map((view) => (
          <button
            key={view}
            type="button"
            className={styles['view']}
            aria-pressed={isViewShown && viewRequest.view === view}
            onClick={() => {
              onViewChange(view);
            }}
          >
            {VIEW_LABELS[view]}
          </button>
        ))}
      </div>
      <div role="status" className={styles['banner']} data-visible={hasTileError}>
        {hasTileError ? 'Map tiles could not load. Use the list.' : ''}
      </div>
      <div className={styles['frame']}>
        <noscript>
          <p className={styles['noscript']}>
            The map needs JavaScript. The park list works without it.
          </p>
        </noscript>
        <ParkMap
          parks={parks}
          allParks={allParks}
          selection={selection}
          viewRequest={viewRequest}
          onSelect={onSelect}
          onTileErrorChange={setHasTileError}
          onOutsideChange={setOutside}
          onViewLeave={() => {
            setLeftViewToken(viewRequest.token);
          }}
        />
        <p className={styles['attribution']}>
          <a href="https://leafletjs.com/">Leaflet</a> | ©{' '}
          <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors
        </p>
      </div>
      <div className={styles['footer']}>
        <Legend />
        <OutsideNote counts={outside} onViewChange={onViewChange} />
      </div>
    </>
  );
}
