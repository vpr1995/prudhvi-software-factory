import { DEFAULT_LIST_STATE, isSort, isStatus } from './search';
import type { ListState } from './search';

const MAX_QUERY_LENGTH = 100;

/**
 * Reads the list state from a URL query, for example `?q=utah&status=visited&sort=rating`.
 * Unknown or invalid values fall back to the defaults.
 *
 * @param search - `window.location.search`, with or without the leading `?`.
 * @returns The list state.
 */
export function parseListState(search: string): ListState {
  const params = new URLSearchParams(search);
  const status = params.get('status');
  const sort = params.get('sort');
  return {
    query: (params.get('q') ?? '').slice(0, MAX_QUERY_LENGTH),
    status: isStatus(status) ? status : DEFAULT_LIST_STATE.status,
    sort: isSort(sort) ? sort : DEFAULT_LIST_STATE.sort,
  };
}

/**
 * Writes the list state as a URL query. Default values are left out.
 *
 * @param state - The list state.
 * @returns For example `?q=utah&sort=rating`, or an empty text for the defaults.
 */
export function serializeListState(state: ListState): string {
  const params = new URLSearchParams();
  if (state.query !== '') {
    params.set('q', state.query);
  }
  if (state.status !== DEFAULT_LIST_STATE.status) {
    params.set('status', state.status);
  }
  if (state.sort !== DEFAULT_LIST_STATE.sort) {
    params.set('sort', state.sort);
  }
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
}
