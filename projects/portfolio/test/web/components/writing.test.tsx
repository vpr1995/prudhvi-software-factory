import { render, screen, within } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { MediumItem } from '../../../src/contracts/feeds';
import { Writing } from '../../../web/components/writing';

const PROFILE = 'https://medium.com/@vprprudhvi';
const MALICIOUS_TITLE = '<script>alert(1)</script><img src=x onerror=alert(1)>';

const items: MediumItem[] = [
  {
    title: 'Older article',
    url: 'https://medium.com/@vprprudhvi/older-aaa',
    publishedAt: '2025-08-03T02:09:50.000Z',
  },
  {
    title: 'Newer article',
    url: 'https://medium.com/@vprprudhvi/newer-bbb',
    publishedAt: '2026-10-16T01:17:45.000Z',
  },
  {
    title: MALICIOUS_TITLE,
    url: 'https://medium.com/@vprprudhvi/evil-ccc',
    publishedAt: '2026-03-30T04:45:04.000Z',
  },
  {
    title: 'Off origin article',
    url: 'https://evil.example.com/post',
    publishedAt: '2026-09-01T00:00:00.000Z',
  },
];

describe('Writing', () => {
  it('has a section with the Writing level 2 heading', () => {
    render(<Writing items={items} profileUrl={PROFILE} />);
    const section = screen.getByRole('heading', { level: 2, name: 'Writing' }).closest('section');
    expect(section).toHaveAttribute('id', 'writing');
  });

  it('lists the articles newest first and drops an item with another origin', () => {
    render(<Writing items={items} profileUrl={PROFILE} />);
    const list = screen.getByRole('list');
    const titles = within(list)
      .getAllByRole('link')
      .map((link) => link.textContent);
    expect(titles).toEqual(['Newer article', MALICIOUS_TITLE, 'Older article']);
    expect(screen.queryByText('Off origin article')).not.toBeInTheDocument();
  });

  it('shows at most max items', () => {
    render(<Writing items={items} max={1} profileUrl={PROFILE} />);
    expect(within(screen.getByRole('list')).getAllByRole('link')).toHaveLength(1);
  });

  it('formats the date as a month and a year, with a machine-readable time', () => {
    const { container } = render(<Writing items={items} profileUrl={PROFILE} />);
    const time = container.querySelector('time[datetime="2026-10-16T01:17:45.000Z"]');
    expect(time).toHaveTextContent('Oct 2026');
  });

  it('renders feed text as text: no live script or img element, and the markup is escaped', () => {
    const { container } = render(<Writing items={items} profileUrl={PROFILE} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('link', { name: MALICIOUS_TITLE })).toBeInTheDocument();

    const markup = renderToStaticMarkup(<Writing items={items} profileUrl={PROFILE} />);
    expect(markup).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(markup).not.toContain('<script');
    expect(markup).not.toContain('<img');
  });

  it('gives every link rel noopener noreferrer and a new tab, on the Medium origin', () => {
    const { container } = render(<Writing items={items} profileUrl={PROFILE} />);
    const links = Array.from(container.querySelectorAll('a'));
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.getAttribute('rel')).toMatch(/noopener/u);
      expect(link.getAttribute('rel')).toMatch(/noreferrer/u);
      expect(link).toHaveAttribute('target', '_blank');
      expect(link.getAttribute('href')?.startsWith('https://medium.com/')).toBe(true);
    }
  });

  it('shows the profile line with a link when there are no items', () => {
    const { container } = render(<Writing items={[]} profileUrl={PROFILE} />);
    expect(screen.queryByRole('list')).toBeNull();
    const link = screen.getByRole('link', { name: 'Read my articles on Medium' });
    expect(link).toHaveAttribute('href', PROFILE);
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(container.querySelectorAll('li')).toHaveLength(0);
  });

  it('shows the profile line when every item has another origin', () => {
    render(
      <Writing
        items={[
          {
            title: 'Off origin only',
            url: 'https://evil.example.com/post',
            publishedAt: '2026-09-01T00:00:00.000Z',
          },
        ]}
        profileUrl={PROFILE}
      />,
    );
    expect(screen.queryByText('Off origin only')).toBeNull();
    expect(screen.getByRole('link', { name: 'Read my articles on Medium' })).toHaveAttribute(
      'href',
      PROFILE,
    );
  });
});
