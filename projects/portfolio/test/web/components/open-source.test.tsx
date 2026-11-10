import { render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Content } from '../../../src/contracts/content';
import type { GithubRepository } from '../../../src/contracts/feeds';
import { OpenSource } from '../../../web/components/open-source';

const PROFILE = 'https://github.com/vpr1995';
const REPO = 'vpr1995/prudhvi-software-factory';

const pinnedRepos: Content['pinnedRepos'] = [
  { fullName: REPO, blurb: 'The owner blurb line.' },
  { fullName: 'owner/not-in-snapshot' },
];

const repos: GithubRepository[] = [
  {
    fullName: REPO,
    url: `https://github.com/${REPO}`,
    description: 'The fetched description.',
  },
];

describe('OpenSource', () => {
  it('has a section with the Open source level 2 heading', () => {
    render(<OpenSource pinnedRepos={pinnedRepos} repos={repos} profileUrl={PROFILE} />);
    const section = screen
      .getByRole('heading', { level: 2, name: 'Open source' })
      .closest('section');
    expect(section).toHaveAttribute('id', 'open-source');
  });

  it('shows the owner blurb before the fetched description', () => {
    const { container } = render(
      <OpenSource pinnedRepos={pinnedRepos} repos={repos} profileUrl={PROFILE} />,
    );
    const blurb = screen.getByText('The owner blurb line.');
    const description = screen.getByText('The fetched description.');
    expect(container.contains(blurb)).toBe(true);
    expect(blurb.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('links the repo name to github.com/fullName with rel noopener noreferrer', () => {
    render(<OpenSource pinnedRepos={pinnedRepos} repos={repos} profileUrl={PROFILE} />);
    const link = screen.getByRole('link', { name: REPO });
    expect(link).toHaveAttribute('href', `https://github.com/${REPO}`);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('shows a pinned repo that is not in the snapshot, with a link built from its name', () => {
    render(<OpenSource pinnedRepos={pinnedRepos} repos={repos} profileUrl={PROFILE} />);
    expect(screen.getByRole('link', { name: 'owner/not-in-snapshot' })).toHaveAttribute(
      'href',
      'https://github.com/owner/not-in-snapshot',
    );
  });

  it('renders feed text as text: script markup is escaped and no live element appears', () => {
    const hostile: GithubRepository[] = [
      {
        fullName: REPO,
        url: `https://github.com/${REPO}`,
        description: '<script>alert(1)</script><img src=x onerror=alert(1)>',
      },
    ];
    const { container } = render(
      <OpenSource pinnedRepos={pinnedRepos} repos={hostile} profileUrl={PROFILE} />,
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('<script>alert(1)</script><img src=x onerror=alert(1)>')).toBeTruthy();

    const markup = renderToStaticMarkup(
      <OpenSource pinnedRepos={pinnedRepos} repos={hostile} profileUrl={PROFILE} />,
    );
    expect(markup).not.toContain('<script');
    expect(markup).not.toContain('<img');
  });

  it('drops a feed description whose url is on another origin', () => {
    const offOrigin: GithubRepository[] = [
      {
        fullName: REPO,
        url: 'https://evil.example.com/repo',
        description: 'Injected description.',
      },
    ];
    render(<OpenSource pinnedRepos={pinnedRepos} repos={offOrigin} profileUrl={PROFILE} />);
    expect(screen.queryByText('Injected description.')).toBeNull();
    expect(screen.getByRole('link', { name: REPO })).toHaveAttribute(
      'href',
      `https://github.com/${REPO}`,
    );
  });

  it('gives every link rel noopener noreferrer', () => {
    const { container } = render(
      <OpenSource pinnedRepos={pinnedRepos} repos={repos} profileUrl={PROFILE} />,
    );
    const links = Array.from(container.querySelectorAll('a'));
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.getAttribute('rel')).toMatch(/noopener/u);
      expect(link.getAttribute('rel')).toMatch(/noreferrer/u);
    }
  });

  it('shows the profile line with a link when there are no pinned repos', () => {
    render(<OpenSource pinnedRepos={[]} repos={repos} profileUrl={PROFILE} />);
    expect(screen.queryByRole('list')).toBeNull();
    const link = screen.getByRole('link', { name: 'See my repos on GitHub' });
    expect(link).toHaveAttribute('href', PROFILE);
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
