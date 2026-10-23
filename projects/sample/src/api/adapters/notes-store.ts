import type { Note } from '../../contracts/index.js';

/** Where notes live. A real project swaps this for a database adapter. */
export type NotesStore = {
  readonly list: () => Promise<readonly Note[]>;
  readonly add: (note: Note) => Promise<void>;
};

/**
 * Creates a store that keeps notes in memory. Lambda keeps the data only while the container lives.
 *
 * @returns An empty store.
 */
export function createInMemoryNotesStore(): NotesStore {
  const notes: Note[] = [];
  return {
    list: () => Promise.resolve([...notes]),
    add: (note) => {
      notes.push(note);
      return Promise.resolve();
    },
  };
}
