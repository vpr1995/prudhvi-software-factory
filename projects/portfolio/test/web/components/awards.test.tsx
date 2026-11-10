import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { Content } from '../../../src/contracts/content';
import { Awards } from '../../../web/components/awards';
import { content } from '../../../web/lib/content';

const awards: Content['awards'] = [
  {
    title: 'Genie High-Performance Award',
    year: '2025',
    issuer: 'Genie',
    source: 'https://example.com/genie-2025',
  },
];

describe('Awards', () => {
  it('has a section with the Awards level 2 heading', () => {
    render(<Awards awards={awards} />);
    const section = screen.getByRole('heading', { level: 2, name: 'Awards' }).closest('section');
    expect(section).toHaveAttribute('id', 'awards');
  });

  it('shows the title, the year and the issuer', () => {
    render(<Awards awards={awards} />);
    expect(
      screen.getByRole('heading', { level: 3, name: 'Genie High-Performance Award' }),
    ).toBeInTheDocument();
    expect(screen.getByText('2025')).toBeInTheDocument();
    expect(screen.getByText('Genie')).toBeInTheDocument();
  });

  it('links to the source in a new tab with rel', () => {
    render(<Awards awards={awards} />);
    const link = screen.getByRole('link', {
      name: 'View source for Genie High-Performance Award',
    });
    expect(link).toHaveAttribute('href', 'https://example.com/genie-2025');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('renders the owner awards from the content by default', () => {
    render(<Awards />);
    expect(
      screen.getByRole('heading', { level: 3, name: content.awards[0]?.title ?? '' }),
    ).toBeInTheDocument();
  });
});
