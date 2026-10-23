import { render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import RootLayout, { metadata, viewport } from '../../../web/app/layout';
import NotFound from '../../../web/app/not-found';
import HomePage from '../../../web/app/page';

describe('HomePage', () => {
  it('renders the real data: 64 parks, none visited yet', () => {
    render(<HomePage />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'National Parks Tracker' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/of 64 parks visited/)).toHaveTextContent('0 of 64 parks visited');
    expect(screen.getByText('Showing 64 of 64 parks')).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
    expect(screen.getByText(/Each park page names the photographer/)).toBeInTheDocument();
  });

  it('renders the full list in the static HTML', () => {
    const html = renderToStaticMarkup(<HomePage />);
    expect(html.match(/<li /g)?.length).toBeGreaterThanOrEqual(64);
    expect(html).toContain('href="/parks/zion/"');
  });
});

describe('RootLayout', () => {
  it('sets the language and starts with a skip link', () => {
    const html = renderToStaticMarkup(
      <RootLayout>
        <main id="main">Page</main>
      </RootLayout>,
    );
    expect(html).toMatch(
      /^<html lang="en"><head><\/head><body><a class="skip-link" href="#main">Skip to main content<\/a>/,
    );
    expect(metadata.title).toBe('National Parks Tracker');
    expect(viewport.themeColor).toHaveLength(2);
  });
});

describe('NotFound', () => {
  it('shows a friendly message with a link home', () => {
    render(<NotFound />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'This trail does not go anywhere',
    );
    expect(screen.getByRole('link', { name: 'Go to the map of all parks' })).toHaveAttribute(
      'href',
      '/',
    );
  });
});
