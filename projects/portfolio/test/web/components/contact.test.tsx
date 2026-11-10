import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Contact } from '../../../web/components/contact';
import { content } from '../../../web/lib/content';

describe('Contact', () => {
  it('has a section with the Contact level 2 heading', () => {
    render(<Contact />);
    const section = screen.getByRole('heading', { level: 2, name: 'Contact' }).closest('section');
    expect(section).toHaveAttribute('id', 'contact');
  });

  it('shows the email address as a mailto link', () => {
    render(<Contact />);
    expect(screen.getByRole('link', { name: content.contact.email })).toHaveAttribute(
      'href',
      `mailto:${content.contact.email}`,
    );
  });

  it('links to LinkedIn, GitHub and Medium with rel', () => {
    render(<Contact />);
    for (const [name, href] of [
      ['LinkedIn', content.contact.linkedin],
      ['GitHub', content.contact.github],
      ['Medium', content.contact.medium],
    ] as const) {
      const link = screen.getByRole('link', { name: href });
      expect(link).toHaveAttribute('href', href);
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });

  it('renders no phone number and no tel link, because the reveal comes later', () => {
    const { container } = render(<Contact />);
    expect(container.querySelector('a[href^="tel:"]')).toBeNull();
    expect(screen.queryByText(/phone/iu)).toBeNull();
  });
});
