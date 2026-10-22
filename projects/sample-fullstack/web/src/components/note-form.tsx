'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { SubmitEvent } from 'react';

import { isFail } from '@vprprudhvi/shared-result';

import { createBrowserApiClient } from '../lib/browser-api';
import type { BrowserApiSettings } from '../lib/browser-api';

/** Props of `NoteForm`. */
export type NoteFormProps = {
  readonly settings: BrowserApiSettings;
};

type Message = { readonly kind: 'success' | 'error'; readonly text: string };

/**
 * A form that creates a note. It calls the API from the browser with the traced `fetch`, so the request
 * carries `traceparent`. After a save it refreshes the page, so the Server Component loads the list again.
 *
 * @param props - The API settings.
 * @returns The form.
 */
export function NoteForm(props: NoteFormProps): React.JSX.Element {
  const { settings } = props;
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<Message | undefined>(undefined);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage(undefined);
    const result = await createBrowserApiClient(settings).createNote({ title, body });
    setIsSubmitting(false);
    if (isFail(result)) {
      setMessage({ kind: 'error', text: result.error.message });
      return;
    }
    setTitle('');
    setBody('');
    setMessage({ kind: 'success', text: `Saved "${result.value.title}".` });
    router.refresh();
  }

  return (
    <form
      onSubmit={(event) => {
        void handleSubmit(event);
      }}
    >
      <p>
        <label htmlFor="note-title">Title</label>
        <br />
        <input
          id="note-title"
          name="title"
          type="text"
          required
          maxLength={120}
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
          }}
        />
      </p>
      <p>
        <label htmlFor="note-body">Body</label>
        <br />
        <textarea
          id="note-body"
          name="body"
          maxLength={2000}
          value={body}
          onChange={(event) => {
            setBody(event.target.value);
          }}
        />
      </p>
      <button type="submit" disabled={isSubmitting}>
        Add note
      </button>
      {message === undefined ? null : (
        <p role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</p>
      )}
    </form>
  );
}
