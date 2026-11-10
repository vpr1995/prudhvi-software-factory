import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Hero } from '../../../web/components/hero';
import { content } from '../../../web/lib/content';

describe('Hero', () => {
  it('shows the name as the level 1 heading', () => {
    render(<Hero />);
    expect(
      screen.getByRole('heading', { level: 1, name: content.profile.name }),
    ).toBeInTheDocument();
  });

  it('shows the role claim and the summary', () => {
    render(<Hero />);
    expect(screen.getByText(content.profile.headline)).toBeInTheDocument();
    expect(screen.getByText(content.profile.summary)).toBeInTheDocument();
  });

  it('shows the location line with the primary place first', () => {
    render(<Hero />);
    const { primary, also } = content.profile.location;
    const line = `Open to relocation: ${[primary, ...also].join(' · ')}`;
    expect(screen.getByText(line)).toBeInTheDocument();
    expect(line.startsWith(`Open to relocation: ${primary}`)).toBe(true);
  });

  it('links to email, LinkedIn, GitHub and Medium, with rel on each', () => {
    render(<Hero />);
    // The hero has two Email links: the call to action and the icon. Both go to the same address.
    const emailLinks = screen.getAllByRole('link', { name: 'Email' });
    expect(emailLinks.length).toBeGreaterThanOrEqual(2);
    for (const link of emailLinks) {
      expect(link).toHaveAttribute('href', `mailto:${content.contact.email}`);
    }
    for (const name of ['LinkedIn', 'GitHub', 'Medium']) {
      const link = screen.getByRole('link', { name });
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
  });
});
