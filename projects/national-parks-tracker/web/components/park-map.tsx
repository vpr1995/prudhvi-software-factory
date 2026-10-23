'use client';

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useEffectEvent, useRef } from 'react';

import { buildPopupContent } from '../lib/popup';
import { countOutside, getViewTarget, LOWER_48_BOUNDS } from '../lib/regions';
import type { Bounds, MapView, OutsideCounts, ViewTarget } from '../lib/regions';
import type { ParkSummary } from '../lib/search';

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const MAX_TILE_ZOOM = 19;
const MIN_ZOOM = 2;
const SELECT_ZOOM = 7;
const FLY_SECONDS = 0.8;
const MARKER_SIZE = 28;
const MARKER_CENTER = 14;
const SELECTED_Z_OFFSET = 1000;
const FIT_PADDING = 24;
const POPUP_MAX_WIDTH = 260;
const SELECT_KEYS: ReadonlySet<string> = new Set(['Enter', ' ']);
/** The map reports tile trouble after this many failed tiles in a row. */
export const TILE_ERROR_LIMIT = 3;

/** How a park was selected. The map flies only for a list selection. */
export type SelectionSource = 'list' | 'map' | 'keyboard';

/** The selected park. `token` changes on each selection, so the same park can be selected again. */
export type Selection = {
  readonly id: string;
  readonly source: SelectionSource;
  readonly token: number;
};

/** A request to show a view. `token` changes on each button press. */
export type ViewRequest = { readonly view: MapView; readonly token: number };

/** Props of `ParkMap`. */
export type ParkMapProps = {
  /** The parks to draw. */
  readonly parks: readonly ParkSummary[];
  /** Every park. The region views use them, so a filter does not move the views. */
  readonly allParks: readonly ParkSummary[];
  readonly selection: Selection | undefined;
  readonly viewRequest: ViewRequest;
  readonly onSelect: (id: string, source: SelectionSource) => void;
  /** Called with true after `TILE_ERROR_LIMIT` failed tiles in a row, and with false when a tile loads again. */
  readonly onTileErrorChange: (hasError: boolean) => void;
  readonly onOutsideChange: (counts: OutsideCounts) => void;
  /** Called when the map leaves the requested view: a drag, a zoom, or a move to a selected park. */
  readonly onViewLeave: () => void;
};

const toLatLngBounds = (bounds: Bounds): L.LatLngBoundsExpression => [
  [bounds[0][0], bounds[0][1]],
  [bounds[1][0], bounds[1][1]],
];

const fromLatLngBounds = (bounds: L.LatLngBounds): Bounds => [
  [bounds.getSouth(), bounds.getWest()],
  [bounds.getNorth(), bounds.getEast()],
];

const prefersReducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Builds the marker icon with DOM nodes. Visited: a filled circle with a check. Not visited: a ring.
 *
 * @param park - The park.
 * @returns The icon.
 */
export function createMarkerIcon(park: ParkSummary): L.DivIcon {
  const dot = document.createElement('span');
  dot.className = 'park-marker__dot';
  if (park.isVisited) {
    const check = document.createElement('span');
    check.className = 'park-marker__check';
    check.setAttribute('aria-hidden', 'true');
    check.textContent = '✓';
    dot.append(check);
  }
  return L.divIcon({
    html: dot,
    className: `park-marker ${park.isVisited ? 'park-marker--visited' : 'park-marker--not-visited'}`,
    iconSize: [MARKER_SIZE, MARKER_SIZE],
    iconAnchor: [MARKER_CENTER, MARKER_CENTER],
    popupAnchor: [0, -MARKER_CENTER],
  });
}

const showTarget = (map: L.Map, target: ViewTarget): void => {
  const shouldAnimate = !prefersReducedMotion();
  if (target.kind === 'point') {
    map.setView([target.lat, target.lng], target.zoom, { animate: shouldAnimate });
    return;
  }
  map.fitBounds(toLatLngBounds(target.bounds), {
    padding: [FIT_PADDING, FIT_PADDING],
    animate: shouldAnimate,
  });
};

const markSelected = (marker: L.Marker, isSelected: boolean): void => {
  marker.getElement()?.classList.toggle('park-marker--selected', isSelected);
  marker.setZIndexOffset(isSelected ? SELECTED_Z_OFFSET : 0);
};

const markerLabel = (park: ParkSummary): string =>
  `${park.name}, ${park.isVisited ? 'visited' : 'not visited yet'}`;

/** What the map calls back. */
type MapHandlers = {
  readonly onTileErrorChange: (hasError: boolean) => void;
  readonly onMoveEnd: (map: L.Map) => void;
  readonly onViewLeave: () => void;
};

/** The map, and the function that moves it for a view request. */
type MapHandle = {
  readonly map: L.Map;
  readonly showView: (target: ViewTarget) => void;
};

/**
 * Adds the OpenStreetMap tiles. It reports trouble after `TILE_ERROR_LIMIT` failed tiles in a row,
 * and reports again when a tile loads, so the banner goes away when the tiles come back.
 *
 * @param map - The map.
 * @param onTileErrorChange - Called with true on trouble and with false on recovery.
 */
function addTiles(map: L.Map, onTileErrorChange: (hasError: boolean) => void): void {
  let failuresInARow = 0;
  let hasError = false;
  L.tileLayer(TILE_URL, { maxZoom: MAX_TILE_ZOOM })
    .on('tileerror', () => {
      failuresInARow += 1;
      if (failuresInARow >= TILE_ERROR_LIMIT && !hasError) {
        hasError = true;
        onTileErrorChange(true);
      }
    })
    .on('tileload', () => {
      failuresInARow = 0;
      if (hasError) {
        hasError = false;
        onTileErrorChange(false);
      }
    })
    .addTo(map);
}

/**
 * Creates the Leaflet map with the OpenStreetMap tiles, on the lower 48.
 *
 * @param container - The map element.
 * @param handlers - Called on tile trouble, after each move, and when the map leaves the view.
 * @returns The map and the function for view requests.
 */
function createMap(container: HTMLElement, handlers: MapHandlers): MapHandle {
  const map = L.map(container, {
    attributionControl: false,
    minZoom: MIN_ZOOM,
    worldCopyJump: true,
  });
  addTiles(map, handlers.onTileErrorChange);
  map.on('moveend', () => {
    handlers.onMoveEnd(map);
  });
  const showView = watchMoves(map, container, handlers.onViewLeave);
  return { map, showView };
}

/**
 * Watches the moves of the map:
 * - It fits the lower 48, and fits them again when the map box changes size (for example when the
 *   note below the map appears) until the first other move: a drag, a zoom or a view button.
 * - It calls `onViewLeave` when a move starts that is not a resize and not a view request.
 *
 * @param map - The map.
 * @param container - The map element.
 * @param onViewLeave - Called when the map leaves the requested view.
 * @returns The function that moves the map for a view request.
 */
function watchMoves(
  map: L.Map,
  container: HTMLElement,
  onViewLeave: () => void,
): (target: ViewTarget) => void {
  let isFirstView = true;
  let isResizing = false;
  // An animated view move starts in the next frame and ends with `moveend`. Every view move ends
  // with `moveend`, also when the map does not move.
  let isViewMove = false;
  const resize = (action: () => void): void => {
    isResizing = true;
    action();
    isResizing = false;
  };
  const fitLower48 = (): void => {
    map.fitBounds(toLatLngBounds(LOWER_48_BOUNDS), { animate: false });
  };
  map.on('movestart', () => {
    if (isResizing) {
      return;
    }
    isFirstView = false;
    if (!isViewMove) {
      onViewLeave();
    }
  });
  map.on('moveend', () => {
    if (!isResizing) {
      isViewMove = false;
    }
  });
  resize(fitLower48);
  const observer = new ResizeObserver(() => {
    resize(() => {
      map.invalidateSize({ animate: false });
      if (isFirstView) {
        fitLower48();
      }
    });
  });
  observer.observe(container);
  map.on('unload', () => {
    observer.disconnect();
  });
  return (target: ViewTarget): void => {
    isViewMove = true;
    showTarget(map, target);
  };
}

/** What `syncMarkers` needs besides the map. */
type MarkerSync = {
  readonly markers: Map<string, L.Marker>;
  readonly parks: readonly ParkSummary[];
  readonly selectedId: string | undefined;
  readonly onSelect: (id: string, source: SelectionSource) => void;
};

/**
 * Adds a marker for each new park and removes the markers of parks that are gone.
 *
 * @param map - The map.
 * @param sync - The markers, the parks, the selection and the select callback.
 */
function syncMarkers(map: L.Map, sync: MarkerSync): void {
  const { markers, parks, selectedId, onSelect } = sync;
  const wanted = new Set(parks.map((park) => park.id));
  for (const [id, marker] of markers) {
    if (!wanted.has(id)) {
      marker.remove();
      markers.delete(id);
    }
  }
  for (const park of parks.filter((candidate) => !markers.has(candidate.id))) {
    const marker = L.marker([park.lat, park.lng], { icon: createMarkerIcon(park), keyboard: true });
    marker.on('click', () => {
      onSelect(park.id, 'map');
    });
    // Leaflet makes the marker a focusable button. Enter and Space select it, like a click.
    // Space must not also scroll the page.
    marker.on('keypress', (event: L.LeafletKeyboardEvent) => {
      if (SELECT_KEYS.has(event.originalEvent.key)) {
        event.originalEvent.preventDefault();
        onSelect(park.id, 'keyboard');
      }
    });
    marker.addTo(map);
    marker.getElement()?.setAttribute('aria-label', markerLabel(park));
    markers.set(park.id, marker);
    markSelected(marker, park.id === selectedId);
  }
}

/**
 * Opens the popup of the selected park. A list selection also moves the map to the park.
 *
 * @param map - The map.
 * @param park - The selected park.
 * @param source - How the park was selected.
 */
function showSelection(map: L.Map, park: ParkSummary, source: SelectionSource): void {
  const content = buildPopupContent(park);
  const isFromList = source === 'list';
  L.popup({ autoPan: !isFromList, maxWidth: POPUP_MAX_WIDTH, className: 'park-popup-shell' })
    .setLatLng([park.lat, park.lng])
    .setContent(content)
    .openOn(map);
  if (isFromList) {
    const zoom = Math.max(map.getZoom(), SELECT_ZOOM);
    if (prefersReducedMotion()) {
      map.setView([park.lat, park.lng], zoom, { animate: false });
    } else {
      map.flyTo([park.lat, park.lng], zoom, { duration: FLY_SECONDS });
    }
  }
  if (source === 'keyboard') {
    content.querySelector('a')?.focus();
  }
}

/**
 * The Leaflet map. Client only: Leaflet needs `window`, so `MapPanel` loads it with `ssr: false`.
 *
 * @param props - The parks, the selection and the callbacks.
 * @returns The map container.
 */
export function ParkMap(props: ParkMapProps): React.JSX.Element {
  const { parks, allParks, selection, viewRequest } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapHandle | null>(null);
  const markersRef = useRef(new Map<string, L.Marker>());
  const parksRef = useRef<readonly ParkSummary[]>(parks);
  const selectedIdRef = useRef<string | undefined>(undefined);

  const reportOutside = useEffectEvent((map: L.Map) => {
    props.onOutsideChange(countOutside(fromLatLngBounds(map.getBounds()), parksRef.current));
  });
  const reportTileError = useEffectEvent((hasError: boolean) => {
    props.onTileErrorChange(hasError);
  });
  const reportViewLeave = useEffectEvent(() => {
    props.onViewLeave();
  });
  const selectPark = useEffectEvent((id: string, source: SelectionSource) => {
    props.onSelect(id, source);
  });

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }
    const markers = markersRef.current;
    const handle = createMap(container, {
      onTileErrorChange: reportTileError,
      onMoveEnd: reportOutside,
      onViewLeave: reportViewLeave,
    });
    mapRef.current = handle;
    return () => {
      handle.map.remove();
      markers.clear();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current?.map;
    parksRef.current = parks;
    if (map === undefined) {
      return;
    }
    const markers = markersRef.current;
    syncMarkers(map, { markers, parks, selectedId: selectedIdRef.current, onSelect: selectPark });
    reportOutside(map);
  }, [parks]);

  useEffect(() => {
    const handle = mapRef.current;
    if (handle !== null && viewRequest.token > 0) {
      handle.showView(getViewTarget(viewRequest.view, allParks));
    }
  }, [viewRequest, allParks]);

  useEffect(() => {
    selectedIdRef.current = selection?.id;
    for (const [id, marker] of markersRef.current) {
      markSelected(marker, id === selection?.id);
    }
    // Read the parks through the ref: a new filter must not open the popup again.
    const park = parksRef.current.find((candidate) => candidate.id === selection?.id);
    const map = mapRef.current?.map;
    if (map !== undefined && selection !== undefined && park !== undefined) {
      showSelection(map, park, selection.source);
    }
  }, [selection]);

  return <div ref={containerRef} className="park-map" />;
}
