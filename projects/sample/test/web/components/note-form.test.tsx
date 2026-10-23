import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { NoteForm } from '../../../web/components/note-form';

const refresh = vi.fn();

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const SETTINGS = { apiBaseUrl: 'http://api.test', serviceVersion: '0.0.0', environment: 'test' };
const NOTE = {
  id: '3f1b9a52-7d0e-4c1a-9b53-2a6f0e5d8c11',
  title: 'Plan',
  body: 'Write it',
  createdAt: '2026-01-02T03:04:05.000Z',
};

describe('NoteForm', () => {
  it('saves a note, sends traceparent, clears the form and refreshes the page', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(Response.json(NOTE, { status: 201 })));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<NoteForm settings={SETTINGS} />);

    await user.type(screen.getByLabelText('Title'), 'Plan');
    await user.type(screen.getByLabelText('Body'), 'Write it');
    await user.click(screen.getByRole('button', { name: 'Add note' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Saved "Plan".');
    expect(screen.getByLabelText('Title')).toHaveValue('');
    expect(refresh).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(init?.body).toBe('{"title":"Plan","body":"Write it"}');
    expect(new Headers(init?.headers).get('traceparent')).not.toBeNull();
  });

  it('shows the error message when the API rejects the note', async () => {
    refresh.mockClear();
    const envelope = {
      error: {
        code: 'NOTE_TITLE_TAKEN',
        message: 'A note with this title exists.',
        requestId: 'r',
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => Promise.resolve(Response.json(envelope, { status: 409 }))),
    );
    const user = userEvent.setup();
    render(<NoteForm settings={SETTINGS} />);

    await user.type(screen.getByLabelText('Title'), 'Plan');
    await user.click(screen.getByRole('button', { name: 'Add note' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('A note with this title exists.');
    expect(screen.getByLabelText('Title')).toHaveValue('Plan');
    expect(refresh).not.toHaveBeenCalled();
  });
});
