import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import HomePage from '../../../web/app/page';
import { content } from '../../../web/lib/content';

describe('HomePage', () => {
  it('shows the headline from the content', () => {
    render(<HomePage />);

    expect(
      screen.getByRole('heading', { level: 1, name: content.profile.name }),
    ).toBeInTheDocument();
  });

  it('composes the sections in order: experience, skills, awards, certifications, open source, writing, contact', () => {
    const { container } = render(<HomePage />);
    const ids = Array.from(container.querySelectorAll('section')).map((section) => section.id);

    expect(ids).toEqual([
      'experience',
      'skills',
      'awards',
      'certifications',
      'open-source',
      'writing',
      'contact',
    ]);
    for (const name of [
      'Experience',
      'Skills',
      'Awards',
      'Certifications',
      'Open source',
      'Writing',
      'Contact',
    ]) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument();
    }
  });
});
