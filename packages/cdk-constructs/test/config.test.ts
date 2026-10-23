import { afterEach, describe, expect, it, vi } from 'vitest';

import { inheritedPath } from '../src/config.js';

describe('inheritedPath', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reads PATH, and counts an empty or missing PATH as unset', () => {
    expect(inheritedPath({ PATH: '/usr/bin:/bin' })).toBe('/usr/bin:/bin');
    expect(inheritedPath({ PATH: '' })).toBeUndefined();
    expect(inheritedPath({})).toBeUndefined();
  });

  it('reads the PATH of this process by default', () => {
    vi.stubEnv('PATH', '/stub/bin');

    expect(inheritedPath()).toBe('/stub/bin');
  });
});
