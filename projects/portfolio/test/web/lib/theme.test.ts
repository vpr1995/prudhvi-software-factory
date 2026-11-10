import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import {
  THEME_SCRIPT,
  THEME_STORAGE_KEY,
  readStoredChoice,
  writeStoredChoice,
} from '../../../web/lib/theme';

/** A storage that holds the values of a map. An `isFailing` storage throws on every call. */
function fakeStorage(values: Record<string, string>, isFailing = false) {
  return {
    getItem: (key: string): string | null => {
      if (isFailing) {
        throw new Error('storage is blocked');
      }
      return key in values ? (values[key] ?? null) : null;
    },
    setItem: (key: string, value: string): void => {
      if (isFailing) {
        throw new Error('storage is blocked');
      }
      values[key] = value;
    },
    removeItem: (key: string): void => {
      if (isFailing) {
        throw new Error('storage is blocked');
      }
      Reflect.deleteProperty(values, key);
    },
  };
}

/**
 * Runs the pre-paint script against a fake page and returns the theme attribute it sets.
 *
 * @param storage - The fake local storage.
 * @returns The value of `data-theme`, or undefined when the script set none.
 */
function runThemeScript(storage: ReturnType<typeof fakeStorage>): string | undefined {
  const dataset: Record<string, string> = {};
  runInNewContext(THEME_SCRIPT, {
    window: { localStorage: storage },
    document: { documentElement: { dataset } },
  });
  return dataset['theme'];
}

describe('THEME_SCRIPT', () => {
  it('sets the theme attribute for a stored light or dark choice', () => {
    expect(runThemeScript(fakeStorage({ [THEME_STORAGE_KEY]: 'dark' }))).toBe('dark');
    expect(runThemeScript(fakeStorage({ [THEME_STORAGE_KEY]: 'light' }))).toBe('light');
  });

  it('sets nothing for system, a missing key or an unknown value', () => {
    expect(runThemeScript(fakeStorage({ [THEME_STORAGE_KEY]: 'system' }))).toBeUndefined();
    expect(runThemeScript(fakeStorage({}))).toBeUndefined();
    expect(runThemeScript(fakeStorage({ [THEME_STORAGE_KEY]: 'purple' }))).toBeUndefined();
  });

  it('does not throw when storage is blocked', () => {
    expect(runThemeScript(fakeStorage({}, true))).toBeUndefined();
  });
});

describe('readStoredChoice', () => {
  it('returns the stored choice', () => {
    const storage = fakeStorage({ [THEME_STORAGE_KEY]: 'light' });
    expect(readStoredChoice(storage)).toBe('light');
  });

  it('returns system when nothing valid is stored or storage is blocked', () => {
    expect(readStoredChoice(fakeStorage({}))).toBe('system');
    expect(readStoredChoice(fakeStorage({ [THEME_STORAGE_KEY]: 'purple' }))).toBe('system');
    expect(readStoredChoice(fakeStorage({}, true))).toBe('system');
  });
});

describe('writeStoredChoice', () => {
  it('stores light and dark under the key', () => {
    const values: Record<string, string> = {};
    writeStoredChoice('dark', fakeStorage(values));
    expect(values[THEME_STORAGE_KEY]).toBe('dark');
  });

  it('removes the key for system', () => {
    const values: Record<string, string> = { [THEME_STORAGE_KEY]: 'dark' };
    writeStoredChoice('system', fakeStorage(values));
    expect(values).not.toHaveProperty(THEME_STORAGE_KEY);
  });

  it('does not throw when storage is blocked', () => {
    expect(() => {
      writeStoredChoice('dark', fakeStorage({}, true));
    }).not.toThrow();
  });
});
