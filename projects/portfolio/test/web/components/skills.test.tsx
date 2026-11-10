import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { Content } from '../../../src/contracts/content';
import { Skills } from '../../../web/components/skills';
import { content } from '../../../web/lib/content';

const groups: Content['skills'] = [
  { category: 'Languages', items: ['TypeScript', 'Go'] },
  { category: 'Cloud', items: ['AWS Lambda', '<img src=x onerror=alert(1)>'] },
];

describe('Skills', () => {
  it('has a section labelled by its level 2 heading', () => {
    render(<Skills groups={groups} />);
    const heading = screen.getByRole('heading', { level: 2, name: 'Skills' });
    const section = heading.closest('section');
    expect(section).toHaveAttribute('id', 'skills');
    expect(section).toHaveAttribute('aria-labelledby', heading.id);
  });

  it('shows each category as a level 3 heading with its items as list items', () => {
    render(<Skills groups={groups} />);
    const languages = screen.getByRole('heading', { level: 3, name: 'Languages' });
    const list = languages.parentElement?.querySelector('ul');
    expect(list).not.toBeNull();
    expect(within(list as HTMLElement).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('TypeScript')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Cloud' })).toBeInTheDocument();
  });

  it('renders an item as text, never as HTML', () => {
    const { container } = render(<Skills groups={groups} />);
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it('shows the groups of the content by default', () => {
    render(<Skills />);
    for (const group of content.skills) {
      expect(screen.getByRole('heading', { level: 3, name: group.category })).toBeInTheDocument();
    }
  });
});
