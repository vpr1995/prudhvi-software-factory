import { describe, expect, it } from 'vitest';

import { createFlagClient, defineFlags } from '../src/flags.js';
import type { FlagProvider } from '../src/flags.js';
import { createEnvFlagProvider, createJsonFlagProvider, toEnvName } from '../src/providers.js';

const flags = defineFlags({
  newNotesList: { defaultValue: false, description: 'Show the new notes list.' },
  legacyExport: { defaultValue: true, description: 'Keep the legacy export.' },
});

describe('createFlagClient', () => {
  it('uses the default value when no provider has an opinion', () => {
    const client = createFlagClient(flags, []);
    expect(client.isEnabled('newNotesList')).toBe(false);
    expect(client.isEnabled('legacyExport')).toBe(true);
  });

  it('lets the first provider with an opinion win', () => {
    const noOpinion: readonly (boolean | undefined)[] = [undefined];
    const silent: FlagProvider = { getValue: () => noOpinion[0] };
    const on: FlagProvider = { getValue: () => true };
    const off: FlagProvider = { getValue: () => false };
    expect(createFlagClient(flags, [silent, on, off]).isEnabled('newNotesList')).toBe(true);
    expect(createFlagClient(flags, [off, on]).isEnabled('legacyExport')).toBe(false);
  });
});

describe('createEnvFlagProvider', () => {
  it('maps camelCase flags to FLAG_ variables', () => {
    expect(toEnvName('newNotesList', 'FLAG_')).toBe('FLAG_NEW_NOTES_LIST');
  });

  it('reads true, false and ignores other values', () => {
    const provider = createEnvFlagProvider({
      FLAG_NEW_NOTES_LIST: ' TRUE ',
      FLAG_LEGACY_EXPORT: 'off',
      FLAG_BETA_SEARCH: 'maybe',
    });
    expect(provider.getValue('newNotesList', {})).toBe(true);
    expect(provider.getValue('legacyExport', {})).toBe(false);
    expect(provider.getValue('betaSearch', {})).toBeUndefined();
    expect(provider.getValue('missingFlag', {})).toBeUndefined();
  });

  it('supports a custom prefix', () => {
    const provider = createEnvFlagProvider({ APP_BETA_SEARCH: '1' }, 'APP_');
    expect(provider.getValue('betaSearch', {})).toBe(true);
  });
});

describe('createJsonFlagProvider', () => {
  const provider = createJsonFlagProvider(
    JSON.stringify({
      plain: true,
      off: false,
      scoped: { enabled: true, environments: ['dev'], userIds: ['u1'] },
      open: { enabled: true },
      disabled: { enabled: false },
    }),
  );

  it('reads boolean flags', () => {
    expect(provider.getValue('plain', {})).toBe(true);
    expect(provider.getValue('off', {})).toBe(false);
    expect(provider.getValue('unknown', {})).toBeUndefined();
  });

  it('matches environments and user ids', () => {
    expect(provider.getValue('scoped', { environment: 'dev', userId: 'u1' })).toBe(true);
    expect(provider.getValue('scoped', { environment: 'prod', userId: 'u1' })).toBe(false);
    expect(provider.getValue('scoped', { environment: 'dev', userId: 'u2' })).toBe(false);
    expect(provider.getValue('scoped', { environment: 'dev' })).toBe(false);
    expect(provider.getValue('open', {})).toBe(true);
    expect(provider.getValue('disabled', {})).toBe(false);
  });

  it('rejects a wrong document', () => {
    expect(() => createJsonFlagProvider('{"flag": "yes"}')).toThrow();
    expect(() => createJsonFlagProvider('not json')).toThrow();
  });
});
