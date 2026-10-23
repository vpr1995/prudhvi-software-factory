import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { NotesList } from '../../../web/components/notes-list';

describe('NotesList', () => {
  it('shows a short text when there are no notes', () => {
    render(<NotesList notes={[]} />);
    expect(screen.getByText('No notes yet.')).toBeInTheDocument();
  });

  it('lists each note with its title and body', () => {
    render(
      <NotesList
        notes={[
          { id: 'a', title: 'First', body: 'Hello', createdAt: '2026-01-01T00:00:00.000Z' },
          { id: 'b', title: 'Second', body: '', createdAt: '2026-01-02T00:00:00.000Z' },
        ]}
      />,
    );
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
  });
});
