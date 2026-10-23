import { describe, expect, it } from 'vitest';

import { DEFAULT_LIST_STATE } from '../../../web/lib/search';
import { parseListState, serializeListState } from '../../../web/lib/url-state';

describe('URL state', () => {
  it('reads valid values, with or without the question mark', () => {
    expect(parseListState('?q=utah&status=visited&sort=rating')).toEqual({
      query: 'utah',
      status: 'visited',
      sort: 'rating',
    });
    expect(parseListState('status=not-visited')).toEqual({
      ...DEFAULT_LIST_STATE,
      status: 'not-visited',
    });
  });

  it('ignores invalid values and cuts a long search', () => {
    expect(parseListState('?status=maybe&sort=__proto__')).toEqual(DEFAULT_LIST_STATE);
    expect(parseListState(`?q=${'a'.repeat(500)}`).query).toHaveLength(100);
  });

  it('writes only the values that are not the default', () => {
    expect(serializeListState(DEFAULT_LIST_STATE)).toBe('');
    expect(serializeListState({ query: 'great smoky', status: 'all', sort: 'rating' })).toBe(
      '?q=great+smoky&sort=rating',
    );
    expect(serializeListState({ query: '', status: 'visited', sort: 'name' })).toBe(
      '?status=visited',
    );
  });

  it('reads back what it writes', () => {
    const state = { query: 'Hawaiʻi & co', status: 'visited', sort: 'last-visited' } as const;
    expect(parseListState(serializeListState(state))).toEqual(state);
  });
});
