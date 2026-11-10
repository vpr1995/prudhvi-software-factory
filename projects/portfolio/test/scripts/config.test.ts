import { describe, expect, it } from 'vitest';

import { readMediumHandle } from '../../scripts/config.ts';

describe('readMediumHandle (R-12)', () => {
  it('returns undefined when the variable is not set or is blank', () => {
    expect(readMediumHandle({})).toBeUndefined();
    expect(readMediumHandle({ FEEDS_MEDIUM_HANDLE: '' })).toBeUndefined();
    expect(readMediumHandle({ FEEDS_MEDIUM_HANDLE: '   ' })).toBeUndefined();
  });

  it('returns a valid handle, with or without the at sign', () => {
    expect(readMediumHandle({ FEEDS_MEDIUM_HANDLE: '@vprprudhvi' })).toBe('@vprprudhvi');
    expect(readMediumHandle({ FEEDS_MEDIUM_HANDLE: ' some.user-1_x ' })).toBe('some.user-1_x');
  });

  it('throws for a value that could change the path or the query of the URL', () => {
    for (const bad of ['a/b', '../x', 'a?b=1', 'a#b', 'a b', '@', '@@a', 'a'.repeat(65)]) {
      expect(() => readMediumHandle({ FEEDS_MEDIUM_HANDLE: bad })).toThrow(/handle/i);
    }
  });
});
