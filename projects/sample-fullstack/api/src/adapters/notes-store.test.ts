import { describe, expect, it } from 'vitest';

import { createInMemoryNotesStore } from './notes-store.js';

describe('createInMemoryNotesStore', () => {
  it('starts empty and keeps added notes', async () => {
    const store = createInMemoryNotesStore();
    expect(await store.list()).toEqual([]);
    const note = {
      id: '3f1b9a52-7d0e-4c1a-9b53-2a6f0e5d8c11',
      title: 'Plan',
      body: '',
      createdAt: '2026-01-02T03:04:05.000Z',
    };
    await store.add(note);
    expect(await store.list()).toEqual([note]);
  });

  it('returns a copy, so callers cannot change the store', async () => {
    const store = createInMemoryNotesStore();
    const list = [...(await store.list())];
    list.push({ id: 'x', title: 'x', body: '', createdAt: 'x' });
    expect(await store.list()).toEqual([]);
  });
});
