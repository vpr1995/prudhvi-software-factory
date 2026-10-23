import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ParkPage, { generateMetadata, generateStaticParams } from '../../../web/app/parks/[id]/page';

// The pages read the fixture visits, like the e2e build.
vi.mock('../../../web/lib/data', async () => {
  const fixtures = await import('../fixtures');
  return { siteData: fixtures.fixtureData };
});

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe('park page', () => {
  it('lists every park for the static export', () => {
    const ids = generateStaticParams().map((entry) => entry.id);
    expect(ids).toHaveLength(64);
    expect(ids).toContain('chiricahua');
  });

  it('builds the title and description', async () => {
    const zion = await generateMetadata(params('zion'));
    expect(zion.title).toBe('Zion · National Parks Tracker');
    expect(zion.description).toMatch(/^Zion National Park in Utah\. Visited\. /);
    expect((await generateMetadata(params('chiricahua'))).description).toContain(
      'Not visited yet.',
    );
    expect(await generateMetadata(params('nowhere'))).toEqual({});
  });

  it('shows a visited park', async () => {
    render(await ParkPage(params('zion')));
    expect(
      screen.getByRole('heading', { level: 1, name: 'Zion National Park' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Rated 5 out of 5' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What we liked' })).toBeInTheDocument();
    const pager = screen.getByRole('navigation', { name: 'Park pages' });
    expect(within(pager).getByRole('link', { name: /Previous park/ })).toHaveAttribute(
      'href',
      '/parks/yosemite/',
    );
    expect(within(pager).getByRole('link', { name: /Next park/ })).toHaveAttribute(
      'href',
      '/parks/acadia/',
    );
  });

  it('shows a park not visited', async () => {
    render(await ParkPage(params('chiricahua')));
    expect(screen.getByText('Not visited yet')).toBeInTheDocument();
    expect(screen.getByText('October 20, 2026')).toBeInTheDocument();
  });

  it('sends an unknown id to the 404 page', async () => {
    await expect(ParkPage(params('nowhere'))).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/);
  });
});
