import { useCallback, useMemo, useSyncExternalStore } from 'react';

import type { ListState } from './search';
import { parseListState, serializeListState } from './url-state';

// The URL query is the store. The static HTML has no query, so the server snapshot is empty and
// the first render shows the full list. After hydration, React reads the real query.
const CHANGE_EVENT = 'npt:list-state-change';

const subscribe = (onChange: () => void): (() => void) => {
  window.addEventListener('popstate', onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
};

const getSnapshot = (): string => window.location.search;
const getServerSnapshot = (): string => '';

/**
 * Keeps the list state in the URL query (`?q=&status=&sort=`) with `history.replaceState`.
 *
 * @returns The current state and a function that replaces it.
 */
export function useListState(): readonly [ListState, (next: ListState) => void] {
  const search = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const state = useMemo(() => parseListState(search), [search]);
  const setState = useCallback((next: ListState) => {
    const query = serializeListState(next);
    const url = `${window.location.pathname}${query}${window.location.hash}`;
    // Next.js patches `replaceState` to keep its router in sync. Pass `null`: a copy of
    // `history.state` carries the router's own keys, and then Next.js skips the sync.
    window.history.replaceState(null, '', url);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);
  return [state, setState] as const;
}
