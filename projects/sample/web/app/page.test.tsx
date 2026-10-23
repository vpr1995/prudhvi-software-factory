import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import HomePage from './page';

vi.mock('next/server', () => ({ connection: () => Promise.resolve() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const NOTE = {
  id: '3f1b9a52-7d0e-4c1a-9b53-2a6f0e5d8c11',
  title: 'Plan',
  body: '',
  createdAt: '2026-01-02T03:04:05.000Z',
};

describe('HomePage', () => {
  it('shows the notes of the API and the form', async () => {
    vi.stubEnv('SAMPLE_WEB_API_URL', 'http://api.test');
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(Response.json({ notes: [NOTE] })));
    vi.stubGlobal('fetch', fetchMock);

    render(await HomePage());

    expect(screen.getByRole('heading', { level: 1, name: 'Notes' })).toBeInTheDocument();
    expect(screen.getByText('Plan')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add note' })).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('http://api.test/v1/notes');
  });

  it('shows an alert when the API is down, and still shows the form', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network down')));

    render(await HomePage());

    expect(screen.getByRole('alert')).toHaveTextContent('The notes did not load');
    expect(screen.getByRole('button', { name: 'Add note' })).toBeInTheDocument();
  });
});
