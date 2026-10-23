'use client';

import { useCallback, useMemo, useRef, useState } from 'react';

import type { MapView } from '../lib/regions';
import { countByStatus, DEFAULT_LIST_STATE, selectParks } from '../lib/search';
import type { ParkSummary } from '../lib/search';
import { useListState } from '../lib/use-list-state';

import { ListControls } from './list-controls';
import { MapPanel } from './map-panel';
import styles from './park-explorer.module.css';
import type { Selection, SelectionSource, ViewRequest } from './park-map';
import { ParkRow } from './park-row';

/** Props of `ParkExplorer`. */
export type ParkExplorerProps = {
  /** Every park, sorted by name. */
  readonly parks: readonly ParkSummary[];
  /** Shown at the end of the list. */
  readonly children?: React.ReactNode;
};

const MOBILE_QUERY = '(max-width: 1023.98px)';

const scrollMapIntoView = (element: HTMLElement | null): void => {
  if (element === null || !window.matchMedia(MOBILE_QUERY).matches) {
    return;
  }
  const isReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  element.scrollIntoView({ behavior: isReduced ? 'auto' : 'smooth', block: 'start' });
};

/**
 * The park list and the map. The list is the main way to move around; the map follows it.
 * The first render (also the static HTML) shows all parks. The URL query applies after hydration.
 *
 * @param props - Every park.
 * @returns The list and map sections.
 */
export function ParkExplorer(props: ParkExplorerProps): React.JSX.Element {
  const { parks, children } = props;
  const [listState, setListState] = useListState();
  const [selection, setSelection] = useState<Selection | undefined>(undefined);
  const [viewRequest, setViewRequest] = useState<ViewRequest>({ view: 'lower48', token: 0 });
  const mapSectionRef = useRef<HTMLElement>(null);

  const visible = useMemo(() => selectParks(parks, listState), [parks, listState]);
  const counts = useMemo(() => countByStatus(parks, listState.query), [parks, listState.query]);

  const select = useCallback((id: string, source: SelectionSource) => {
    setSelection((previous) => ({ id, source, token: (previous?.token ?? 0) + 1 }));
  }, []);
  const showOnMap = useCallback(
    (id: string) => {
      select(id, 'list');
      scrollMapIntoView(mapSectionRef.current);
    },
    [select],
  );
  const changeView = useCallback((view: MapView) => {
    setViewRequest((previous) => ({ view, token: previous.token + 1 }));
  }, []);

  return (
    <div className={styles['explorer']}>
      <section className={styles['list']} aria-labelledby="parks-heading">
        <h2 id="parks-heading" className={styles['heading']}>
          Parks
        </h2>
        <ListControls state={listState} counts={counts} onChange={setListState} />
        <p className={styles['count']} aria-live="polite">
          Showing {visible.length} of {parks.length} parks
        </p>
        {visible.length === 0 ? (
          <div className={styles['empty']}>
            <p>No parks match your search and filter.</p>
            <button
              type="button"
              className={styles['clear']}
              onClick={() => {
                setListState({
                  ...listState,
                  query: DEFAULT_LIST_STATE.query,
                  status: DEFAULT_LIST_STATE.status,
                });
              }}
            >
              Clear filters
            </button>
          </div>
        ) : (
          <ul className={styles['rows']} aria-labelledby="parks-heading">
            {visible.map((park) => (
              <ParkRow
                key={park.id}
                park={park}
                isSelected={park.id === selection?.id}
                onShowOnMap={showOnMap}
              />
            ))}
          </ul>
        )}
        {children}
      </section>
      <section ref={mapSectionRef} className={styles['map']} aria-labelledby="map-heading">
        <h2 id="map-heading" className="visually-hidden">
          Map
        </h2>
        <MapPanel
          parks={visible}
          allParks={parks}
          selection={selection}
          viewRequest={viewRequest}
          onViewChange={changeView}
          onSelect={select}
        />
      </section>
    </div>
  );
}
