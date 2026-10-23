import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ParkMapProps } from '../../../web/components/park-map';
import { fixtureSummaries, summaryOf } from '../fixtures';

type Handler = (event?: unknown) => void;

// A small stand-in for Leaflet. It records what the component asks for.
const fake = vi.hoisted(() => {
  class Emitter {
    readonly handlers = new Map<string, Handler[]>();

    on(name: string, handler: Handler): this {
      this.handlers.set(name, [...(this.handlers.get(name) ?? []), handler]);
      return this;
    }

    fire(name: string, event?: unknown): void {
      for (const handler of this.handlers.get(name) ?? []) {
        handler(event);
      }
    }
  }

  // Like Leaflet, each move starts with `movestart`. The test fires `moveend` when it needs it.
  class FakeMap extends Emitter {
    readonly calls: { name: string; args: unknown[] }[] = [];
    zoom = 4;
    bounds = { south: 24.4, west: -124.8, north: 49.4, east: -66.9 };
    isRemoved = false;

    constructor(readonly container: HTMLElement) {
      super();
    }

    fitBounds(...args: unknown[]): this {
      this.calls.push({ name: 'fitBounds', args });
      this.fire('movestart');
      return this;
    }

    setView(...args: unknown[]): this {
      this.calls.push({ name: 'setView', args });
      this.fire('movestart');
      return this;
    }

    flyTo(...args: unknown[]): this {
      this.calls.push({ name: 'flyTo', args });
      this.fire('movestart');
      return this;
    }

    getZoom(): number {
      return this.zoom;
    }

    getBounds(): Record<string, () => number> {
      const { south, west, north, east } = this.bounds;
      return {
        getSouth: () => south,
        getWest: () => west,
        getNorth: () => north,
        getEast: () => east,
      };
    }

    invalidateSize(...args: unknown[]): this {
      this.calls.push({ name: 'invalidateSize', args });
      return this;
    }

    remove(): void {
      this.isRemoved = true;
      this.fire('unload');
    }
  }

  class FakeResizeObserver {
    static last: FakeResizeObserver | undefined;
    isObserving = false;

    constructor(readonly callback: () => void) {
      FakeResizeObserver.last = this;
    }

    observe(): void {
      this.isObserving = true;
    }

    disconnect(): void {
      this.isObserving = false;
    }
  }

  class FakeTileLayer extends Emitter {
    constructor(readonly url: string) {
      super();
    }

    addTo(): this {
      return this;
    }
  }

  class FakeMarker extends Emitter {
    readonly element = document.createElement('div');
    zIndexOffset = 0;
    isRemoved = false;

    constructor(
      readonly latLng: [number, number],
      readonly options: { icon: { options: { className: string; html: HTMLElement } } },
    ) {
      super();
      this.element.className = options.icon.options.className;
      this.element.append(options.icon.options.html);
    }

    addTo(map: FakeMap): this {
      map.container.append(this.element);
      return this;
    }

    getElement(): HTMLElement {
      return this.element;
    }

    setZIndexOffset(offset: number): this {
      this.zIndexOffset = offset;
      return this;
    }

    remove(): this {
      this.isRemoved = true;
      this.element.remove();
      return this;
    }
  }

  class FakePopup {
    content: HTMLElement | undefined;
    latLng: [number, number] | undefined;

    constructor(readonly options: { autoPan: boolean }) {}

    setLatLng(latLng: [number, number]): this {
      this.latLng = latLng;
      return this;
    }

    setContent(content: HTMLElement): this {
      this.content = content;
      return this;
    }

    openOn(map: FakeMap): this {
      if (this.content !== undefined) {
        map.container.append(this.content);
      }
      return this;
    }
  }

  const state = {
    maps: [] as FakeMap[],
    tileLayers: [] as FakeTileLayer[],
    markers: [] as FakeMarker[],
    popups: [] as FakePopup[],
  };
  const leaflet = {
    map: (container: HTMLElement) => {
      const map = new FakeMap(container);
      state.maps.push(map);
      return map;
    },
    tileLayer: (url: string) => {
      const layer = new FakeTileLayer(url);
      state.tileLayers.push(layer);
      return layer;
    },
    marker: (
      latLng: [number, number],
      options: { icon: { options: { className: string; html: HTMLElement } } },
    ) => {
      const marker = new FakeMarker(latLng, options);
      state.markers.push(marker);
      return marker;
    },
    divIcon: (options: unknown) => ({ options }),
    popup: (options: { autoPan: boolean }) => {
      const popup = new FakePopup(options);
      state.popups.push(popup);
      return popup;
    },
  };
  return { leaflet, state, FakeResizeObserver };
});

vi.mock('leaflet', () => ({ default: fake.leaflet }));

const { ParkMap, TILE_ERROR_LIMIT, createMarkerIcon } =
  await import('../../../web/components/park-map');

/**
 * Sets the result of `matchMedia` for every query.
 *
 * @param isMatching - True to match, for example reduced motion on.
 */
function stubMatchMedia(isMatching: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({ matches: isMatching, media: query })),
  );
}

/**
 * Renders the map with default props.
 *
 * @param overrides - Props to change.
 * @returns The render result and the callbacks.
 */
function renderMap(overrides: Partial<ParkMapProps> = {}) {
  const props: ParkMapProps = {
    parks: fixtureSummaries,
    allParks: fixtureSummaries,
    selection: undefined,
    viewRequest: { view: 'lower48', token: 0 },
    onSelect: vi.fn(),
    onTileErrorChange: vi.fn(),
    onOutsideChange: vi.fn(),
    onViewLeave: vi.fn(),
    ...overrides,
  };
  const result = render(<ParkMap {...props} />);
  const rerender = (next: Partial<ParkMapProps>): void => {
    result.rerender(<ParkMap {...props} {...next} />);
  };
  return { ...result, props, rerender };
}

const lastMap = () => {
  const map = fake.state.maps.at(-1);
  if (map === undefined) {
    throw new Error('No map was created.');
  }
  return map;
};

const markerOf = (id: string) => {
  const park = summaryOf(id);
  const marker = fake.state.markers.find(
    (candidate) =>
      candidate.latLng[0] === park.lat && candidate.latLng[1] === park.lng && !candidate.isRemoved,
  );
  if (marker === undefined) {
    throw new Error(`No marker for ${id}.`);
  }
  return marker;
};

beforeEach(() => {
  fake.state.maps.length = 0;
  fake.state.tileLayers.length = 0;
  fake.state.markers.length = 0;
  fake.state.popups.length = 0;
  stubMatchMedia(false);
  vi.stubGlobal('ResizeObserver', fake.FakeResizeObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ParkMap', () => {
  it('creates the map on the lower 48 with the OpenStreetMap tiles and one marker for each park', () => {
    const { props, unmount } = renderMap();
    const map = lastMap();
    expect(fake.state.tileLayers[0]?.url).toBe('https://tile.openstreetmap.org/{z}/{x}/{y}.png');
    expect(map.calls[0]).toEqual({
      name: 'fitBounds',
      args: [
        [
          [24.4, -124.8],
          [49.4, -66.9],
        ],
        { animate: false },
      ],
    });
    expect(fake.state.markers).toHaveLength(64);
    expect(markerOf('zion').element.getAttribute('aria-label')).toBe('Zion, visited');
    expect(markerOf('chiricahua').element.getAttribute('aria-label')).toBe(
      'Chiricahua, not visited yet',
    );
    expect(props.onOutsideChange).toHaveBeenLastCalledWith(expect.objectContaining({ total: 12 }));
    unmount();
    expect(map.isRemoved).toBe(true);
  });

  it('reports the parks outside the view after each move', () => {
    const { props } = renderMap();
    const map = lastMap();
    map.bounds = { south: -90, west: -180, north: 90, east: 180 };
    act(() => {
      map.fire('moveend');
    });
    expect(props.onOutsideChange).toHaveBeenLastCalledWith(expect.objectContaining({ total: 0 }));
  });

  it('reports tile trouble once, after the limit of failed tiles in a row', () => {
    const { props } = renderMap();
    const layer = fake.state.tileLayers[0];
    act(() => {
      for (let count = 0; count < TILE_ERROR_LIMIT + 2; count += 1) {
        layer?.fire('tileerror');
      }
    });
    expect(props.onTileErrorChange).toHaveBeenCalledTimes(1);
    expect(props.onTileErrorChange).toHaveBeenLastCalledWith(true);
  });

  it('does not report failed tiles that are not in a row', () => {
    const { props } = renderMap();
    const layer = fake.state.tileLayers[0];
    act(() => {
      for (let count = 0; count < TILE_ERROR_LIMIT * 2; count += 1) {
        layer?.fire('tileerror');
        layer?.fire('tileload');
      }
    });
    expect(props.onTileErrorChange).not.toHaveBeenCalled();
  });

  it('reports the recovery when a tile loads again, and new trouble after it', () => {
    const { props } = renderMap();
    const layer = fake.state.tileLayers[0];
    const failTiles = (): void => {
      for (let count = 0; count < TILE_ERROR_LIMIT; count += 1) {
        layer?.fire('tileerror');
      }
    };
    act(failTiles);
    act(() => {
      layer?.fire('tileload');
      layer?.fire('tileload');
    });
    expect(vi.mocked(props.onTileErrorChange).mock.calls).toEqual([[true], [false]]);
    act(failTiles);
    expect(vi.mocked(props.onTileErrorChange).mock.calls).toEqual([[true], [false], [true]]);
  });

  it('selects a park on a click, on Enter and on Space, but not on other keys', () => {
    const { props } = renderMap();
    const marker = markerOf('zion');
    const press = (key: string): KeyboardEvent => {
      const event = new KeyboardEvent('keypress', { key, cancelable: true });
      marker.fire('keypress', { originalEvent: event });
      return event;
    };
    marker.fire('click');
    expect(props.onSelect).toHaveBeenLastCalledWith('zion', 'map');
    expect(press('a').defaultPrevented).toBe(false);
    expect(props.onSelect).toHaveBeenCalledTimes(1);
    expect(press('Enter').defaultPrevented).toBe(true);
    expect(props.onSelect).toHaveBeenLastCalledWith('zion', 'keyboard');
    expect(press(' ').defaultPrevented).toBe(true);
    expect(props.onSelect).toHaveBeenCalledTimes(3);
    expect(props.onSelect).toHaveBeenLastCalledWith('zion', 'keyboard');
  });

  it('reports when the user moves the map away from the requested view', () => {
    const { props, rerender } = renderMap();
    const map = lastMap();
    // The move of a view request does not count, until it ends. An animated move starts later.
    rerender({ viewRequest: { view: 'alaska', token: 1 } });
    expect(props.onViewLeave).not.toHaveBeenCalled();
    act(() => {
      map.fire('movestart');
    });
    expect(props.onViewLeave).not.toHaveBeenCalled();
    act(() => {
      map.fire('moveend');
    });
    // A drag, a zoom or a move to a selected park starts a move of its own.
    act(() => {
      map.fire('movestart');
    });
    expect(props.onViewLeave).toHaveBeenCalledTimes(1);
  });

  it('opens the popup and flies to a park selected in the list', () => {
    const { props, rerender } = renderMap();
    rerender({ selection: { id: 'zion', source: 'list', token: 1 } });
    const popup = fake.state.popups.at(-1);
    expect(popup?.content?.textContent).toContain('Zion');
    expect(popup?.options.autoPan).toBe(false);
    expect(lastMap().calls.at(-1)).toEqual({
      name: 'flyTo',
      args: [[summaryOf('zion').lat, summaryOf('zion').lng], 7, { duration: 0.8 }],
    });
    expect(markerOf('zion').element.classList.contains('park-marker--selected')).toBe(true);
    expect(markerOf('zion').zIndexOffset).toBeGreaterThan(0);
    // The flight leaves the requested view.
    expect(props.onViewLeave).toHaveBeenCalledTimes(1);
  });

  it('jumps without animation when reduced motion is on', () => {
    stubMatchMedia(true);
    const { rerender } = renderMap();
    rerender({ selection: { id: 'acadia', source: 'list', token: 1 } });
    expect(lastMap().calls.at(-1)?.name).toBe('setView');
  });

  it('moves the focus into the popup after a keyboard selection, and does not move the map', () => {
    const { rerender } = renderMap();
    const callsBefore = lastMap().calls.length;
    rerender({ selection: { id: 'zion', source: 'keyboard', token: 1 } });
    expect(document.activeElement?.textContent).toBe('View park');
    expect(fake.state.popups.at(-1)?.options.autoPan).toBe(true);
    expect(lastMap().calls).toHaveLength(callsBefore);
  });

  it('removes the markers of parks that the filter hides, and keeps the selection mark', () => {
    const { rerender } = renderMap({ selection: { id: 'zion', source: 'map', token: 1 } });
    const zion = summaryOf('zion');
    rerender({ parks: [zion], selection: { id: 'zion', source: 'map', token: 1 } });
    expect(fake.state.markers.filter((marker) => !marker.isRemoved)).toHaveLength(1);
    rerender({ parks: fixtureSummaries, selection: { id: 'zion', source: 'map', token: 1 } });
    expect(fake.state.markers.filter((marker) => !marker.isRemoved)).toHaveLength(64);
    expect(markerOf('zion').element.classList.contains('park-marker--selected')).toBe(true);
  });

  it('moves to a region on request: a box, or a point for a single park', () => {
    const { rerender } = renderMap();
    rerender({ viewRequest: { view: 'alaska', token: 1 } });
    expect(lastMap().calls.at(-1)?.name).toBe('fitBounds');
    rerender({ viewRequest: { view: 'virgin-islands', token: 2 } });
    expect(lastMap().calls.at(-1)).toEqual({
      name: 'setView',
      args: [
        [summaryOf('virgin-islands').lat, summaryOf('virgin-islands').lng],
        9,
        { animate: true },
      ],
    });
  });
});

describe('ParkMap on resize', () => {
  const resizeObserver = () => {
    const observer = fake.FakeResizeObserver.last;
    if (observer === undefined) {
      throw new Error('No ResizeObserver was created.');
    }
    return observer;
  };

  it('fits the lower 48 again when the map box changes size, until the first other move', () => {
    const { props, unmount } = renderMap();
    const map = lastMap();
    const observer = resizeObserver();
    expect(observer.isObserving).toBe(true);
    observer.callback();
    expect(map.calls.slice(-2).map((call) => call.name)).toEqual(['invalidateSize', 'fitBounds']);
    expect(props.onViewLeave).not.toHaveBeenCalled();
    // A drag or a view button starts a move. After it, a resize keeps the view.
    map.fire('movestart');
    observer.callback();
    expect(map.calls.at(-1)?.name).toBe('invalidateSize');
    unmount();
    expect(observer.isObserving).toBe(false);
  });
});

describe('createMarkerIcon', () => {
  it('draws a check for a visited park and a ring for a park not visited', () => {
    const visited = createMarkerIcon(summaryOf('zion'));
    const notVisited = createMarkerIcon(summaryOf('chiricahua'));
    expect(visited.options.className).toContain('park-marker--visited');
    expect(notVisited.options.className).toContain('park-marker--not-visited');
    const html = visited.options.html;
    expect(html instanceof HTMLElement && html.textContent).toBe('✓');
    const ring = notVisited.options.html;
    expect(ring instanceof HTMLElement && ring.textContent).toBe('');
  });
});
