import { render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import RootLayout, { metadata, viewport } from '../../../web/app/layout';
import NotFound from '../../../web/app/not-found';

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
