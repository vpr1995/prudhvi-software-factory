import { describe, expect, it } from 'vitest';

import { isFail, isOk } from '@vprprudhvi/shared-result';

import type { Note } from '@vprprudhvi/sample-api-only-contracts';

import {
  createNote,
  DuplicateNoteTitleError,
  MAX_NOTES,
  NoteLimitReachedError,
  sortNotes,
} from './notes.js';

const NOW = new Date('2026-01-02T03:04:05.000Z');
const ID = '3f1b9a52-7d0e-4c1a-9b53-2a6f0e5d8c11';

function makeNote(title: string, createdAt = NOW.toISOString()): Note {
  return { id: ID, title, body: '', createdAt };
}

describe('createNote', () => {
  it('returns the new note', () => {
    const result = createNote(
      { title: 'Plan', body: 'Write' },
      { existingNotes: [], id: ID, now: NOW },
    );
    expect(isOk(result) && result.value).toEqual({
      id: ID,
      title: 'Plan',
      body: 'Write',
      createdAt: NOW.toISOString(),
    });
  });

  it('rejects a duplicate title, ignoring case', () => {
    const result = createNote(
      { title: 'plan', body: '' },
      { existingNotes: [makeNote('PLAN')], id: ID, now: NOW },
    );
    expect(isFail(result) && result.error).toBeInstanceOf(DuplicateNoteTitleError);
    expect(isFail(result) && result.error.code).toBe('NOTE_TITLE_TAKEN');
  });

  it('rejects a note over the limit', () => {
    const existingNotes = Array.from({ length: MAX_NOTES }, (_, index) =>
      makeNote(`Note ${String(index)}`),
    );
    const result = createNote({ title: 'One more', body: '' }, { existingNotes, id: ID, now: NOW });
    expect(isFail(result) && result.error).toBeInstanceOf(NoteLimitReachedError);
  });
});

describe('sortNotes', () => {
  it('sorts oldest first and keeps the input unchanged', () => {
    const newer = makeNote('Newer', '2026-02-01T00:00:00.000Z');
    const older = makeNote('Older', '2026-01-01T00:00:00.000Z');
    const input = [newer, older];
    expect(sortNotes(input)).toEqual([older, newer]);
    expect(input).toEqual([newer, older]);
  });
});
