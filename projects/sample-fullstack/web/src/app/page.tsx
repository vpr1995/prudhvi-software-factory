import { connection } from 'next/server';

import { isFail } from '@vprprudhvi/shared-result';

import { NoteForm } from '../components/note-form';
import { NotesList } from '../components/notes-list';
import { loadWebConfig } from '../config';
import { createServerApiClient } from '../lib/server-api';

/**
 * The home page. A Server Component: it loads the notes on the server and renders them.
 *
 * @returns The page.
 */
export default async function HomePage(): Promise<React.JSX.Element> {
  // The list comes from the API at request time. Never build this page ahead of time.
  await connection();
  const config = loadWebConfig();
  const result = await createServerApiClient(config.apiBaseUrl).listNotes();
  return (
    <main>
      <h1>Notes</h1>
      {isFail(result) ? (
        <p role="alert">The notes did not load: {result.error.message}</p>
      ) : (
        <NotesList notes={result.value} />
      )}
      <h2>Add a note</h2>
      <NoteForm
        settings={{
          apiBaseUrl: config.apiBaseUrl,
          serviceVersion: config.serviceVersion,
          environment: config.environment,
          tracesUrl: config.browserTracesUrl,
        }}
      />
    </main>
  );
}
