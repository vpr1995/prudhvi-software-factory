import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_LIST_STATE } from '../../../web/lib/search';
import { useListState } from '../../../web/lib/use-list-state';

beforeEach(() => {
  // The Next.js router keeps its own data in `history.state`, under keys like `__NA`.
  const routerState = Object.fromEntries<unknown>([
    ['__NA', true],
    ['__PRIVATE_NEXTJS_INTERNALS_TREE', {}],
  ]);
  window.history.replaceState(routerState, '', '/#map');
});

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('useListState', () => {
  it('reads the state from the URL query', () => {
    window.history.replaceState(null, '', '/?q=utah&status=visited');
    const { result } = renderHook(() => useListState());
    expect(result.current[0]).toEqual({ ...DEFAULT_LIST_STATE, query: 'utah', status: 'visited' });
  });

  it('writes the state with replaceState(null), so the Next.js router stays in sync', () => {
    const replaceState = vi.spyOn(window.history, 'replaceState');
    const { result } = renderHook(() => useListState());
    act(() => {
      result.current[1]({ ...DEFAULT_LIST_STATE, query: 'zion' });
    });
    expect(replaceState).toHaveBeenCalledWith(null, '', '/?q=zion#map');
    expect(result.current[0].query).toBe('zion');
  });
});
