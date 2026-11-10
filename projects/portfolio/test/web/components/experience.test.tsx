import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { Content } from '../../../src/contracts/content';
import { Experience } from '../../../web/components/experience';
import { content } from '../../../web/lib/content';

const entries: Content['experience'] = [
  {
    company: 'Acme Labs',
    role: 'Staff Engineer',
    location: 'Boston',
    start: '2020-01',
    end: null,
    bullets: ['Built the payments platform.', 'Led the migration to events.'],
    metrics: [{ label: 'Uptime', value: '99.95%' }],
  },
  {
    company: 'Beta Corp',
    role: 'Engineer',
    location: 'Seattle',
    start: '2016-03',
    end: '2019-11',
    bullets: ['Shipped the search service.'],
  },
];

describe('Experience', () => {
  it('has a section labelled by its level 2 heading', () => {
    render(<Experience entries={entries} />);
    const section = screen
      .getByRole('heading', { level: 2, name: 'Experience' })
      .closest('section');
    expect(section).toHaveAttribute('id', 'experience');
    expect(section).toHaveAttribute(
      'aria-labelledby',
      screen.getByRole('heading', { level: 2 }).id,
    );
  });

  it('shows each role as a level 3 heading with its company and location', () => {
    render(<Experience entries={entries} />);
    expect(screen.getByRole('heading', { level: 3, name: 'Staff Engineer' })).toBeInTheDocument();
    expect(screen.getByText('Acme Labs')).toBeInTheDocument();
    expect(screen.getByText('Seattle')).toBeInTheDocument();
  });

  it('shows Present when the role has no end, and the end month otherwise', () => {
    render(<Experience entries={entries} />);
    expect(screen.getByText('Jan 2020 – Present')).toBeInTheDocument();
    expect(screen.getByText('Mar 2016 – Nov 2019')).toBeInTheDocument();
  });

  it('lists the bullets', () => {
    render(<Experience entries={entries} />);
    const list = screen.getByText('Built the payments platform.').closest('ul');
    expect(list).not.toBeNull();
    expect(within(list as HTMLElement).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Shipped the search service.')).toBeInTheDocument();
  });

  it('shows metrics as label and value pairs', () => {
    render(<Experience entries={entries} />);
    expect(screen.getByRole('term')).toHaveTextContent('Uptime');
    expect(screen.getByRole('definition')).toHaveTextContent('99.95%');
  });

  it('renders the owner entries from the content by default', () => {
    render(<Experience />);
    expect(
      screen.getByRole('heading', { level: 3, name: content.experience[0]?.role ?? '' }),
    ).toBeInTheDocument();
  });
});
