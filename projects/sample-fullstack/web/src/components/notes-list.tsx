import type { Note } from '@vprprudhvi/sample-fullstack-contracts';

/** Props of `NotesList`. */
export type NotesListProps = {
  readonly notes: readonly Note[];
};

/**
 * Lists notes. A Server Component: it has no state and no client code.
 *
 * @param props - The notes to show.
 * @returns The list, or a short text when there are no notes.
 */
export function NotesList(props: NotesListProps): React.JSX.Element {
  const { notes } = props;
  if (notes.length === 0) {
    return <p>No notes yet.</p>;
  }
  return (
    <ul aria-label="Notes">
      {notes.map((note) => (
        <li key={note.id}>
          <strong>{note.title}</strong>
          {note.body === '' ? null : <p>{note.body}</p>}
        </li>
      ))}
    </ul>
  );
}
