import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Contact } from '../../../web/components/contact';
import type * as contentModule from '../../../web/lib/content';
import { content } from '../../../web/lib/content';

// The tests switch the phone off for one case. The real content has a phone, so the mock reads
// the switch and returns the content without it.
const overrides = vi.hoisted(() => ({ withoutPhone: false }));

vi.mock('../../../web/lib/content', async (importOriginal) => {
  const actual = await importOriginal<typeof contentModule>();
  return {
    ...actual,
    get content(): typeof actual.content {
      if (!overrides.withoutPhone) {
        return actual.content;
      }
      return { ...actual.content, contact: { ...actual.content.contact, phone: undefined } };
    },
  };
});

afterEach(() => {
  overrides.withoutPhone = false;
});

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

  it('shows a Phone row with the reveal button, and no number before the click', () => {
    const { container } = render(<Contact />);

    expect(screen.getByText('Phone', { exact: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show phone number' })).toBeInTheDocument();
    expect(container.textContent).not.toContain('010-0100');
    expect(container.querySelector('a[href^="tel:"]')).toBeNull();
  });

  it('has no Phone row when the content has no phone', () => {
    overrides.withoutPhone = true;
    render(<Contact />);

    expect(screen.queryByText('Phone', { exact: true })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show phone number' })).toBeNull();
    expect(screen.getByRole('link', { name: content.contact.email })).toBeInTheDocument();
  });
});
