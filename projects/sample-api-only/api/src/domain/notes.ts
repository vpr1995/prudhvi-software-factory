import { AppError, fail, ok } from '@vprprudhvi/shared-result';
import type { Result } from '@vprprudhvi/shared-result';

import type { CreateNote, Note } from '@vprprudhvi/sample-api-only-contracts';

/** The most notes the service stores. */
export const MAX_NOTES = 100;

/** A note with this title exists. */
export class DuplicateNoteTitleError extends AppError {
  readonly code = 'NOTE_TITLE_TAKEN';
}

/** The service already stores `MAX_NOTES` notes. */
export class NoteLimitReachedError extends AppError {
  readonly code = 'NOTE_LIMIT_REACHED';
}

/** The expected errors of `createNote`. */
export type CreateNoteError = DuplicateNoteTitleError | NoteLimitReachedError;

/** What `createNote` needs from the outside. The caller creates the values, so the function stays pure. */
export type CreateNoteContext = {
  readonly existingNotes: readonly Note[];
  readonly id: string;
  readonly now: Date;
};

/**
 * Applies the rules for a new note.
 *
 * @param input - The validated request body.
 * @param context - The stored notes, a new id and the current time.
 * @returns The new note, or an expected error.
 */
export function createNote(
  input: CreateNote,
  context: CreateNoteContext,
): Result<Note, CreateNoteError> {
  const { existingNotes, id, now } = context;
  if (existingNotes.length >= MAX_NOTES) {
    return fail(
      new NoteLimitReachedError(`The service stores at most ${String(MAX_NOTES)} notes.`),
    );
  }
  const key = input.title.toLowerCase();
  if (existingNotes.some((note) => note.title.toLowerCase() === key)) {
    return fail(new DuplicateNoteTitleError('A note with this title exists.'));
  }
  return ok({ id, title: input.title, body: input.body, createdAt: now.toISOString() });
}

/**
 * Sorts notes by creation time, oldest first.
 *
 * @param notes - The notes to sort.
 * @returns A new sorted array.
 */
export function sortNotes(notes: readonly Note[]): Note[] {
  return notes.toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
}
