import { describe, expect, it } from 'vitest';

import { DEFAULT_VISITS_FILE, loadWebConfig } from '../../web/config';

describe('loadWebConfig', () => {
  it('uses the real visits file and the default export folder when nothing is set', () => {
    expect(loadWebConfig({})).toEqual({ visitsFile: DEFAULT_VISITS_FILE, outDir: undefined });
    expect(loadWebConfig({ NPT_VISITS_FILE: '', NPT_OUT_DIR: '' })).toEqual({
      visitsFile: 'data/visits.json',
      outDir: undefined,
    });
  });

  it('accepts the e2e settings', () => {
    expect(
      loadWebConfig({
        NPT_VISITS_FILE: '../test/fixtures/visits.e2e.json',
        NPT_OUT_DIR: 'out-e2e',
      }),
    ).toEqual({
      visitsFile: '../test/fixtures/visits.e2e.json',
      outDir: 'out-e2e',
    });
  });

  it.each([
    '/etc/passwd.json',
    '../../secrets.json',
    'data/visits.txt',
    'data/../../x.json',
    'data//x.json',
  ])('rejects the visits file %s', (value) => {
    expect(() => loadWebConfig({ NPT_VISITS_FILE: value })).toThrow(
      'Use a relative path to a .json file',
    );
  });

  it.each(['../out', 'dist', 'out/x', 'OUT'])('rejects the export folder %s', (value) => {
    expect(() => loadWebConfig({ NPT_OUT_DIR: value })).toThrow(
      'Use a folder name that starts with',
    );
  });

  it('reads the process environment by default', () => {
    expect(loadWebConfig().visitsFile).toMatch(/\.json$/);
  });
});
