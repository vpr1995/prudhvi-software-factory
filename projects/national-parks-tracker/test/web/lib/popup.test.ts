import { describe, expect, it } from 'vitest';

import { buildPopupContent, getVisitLine } from '../../../web/lib/popup';
import { makeSummary } from '../fixtures';

describe('popup', () => {
  it('shows a visited park with its last visit, rating and link', () => {
    const content = buildPopupContent(
      makeSummary({ isVisited: true, lastVisit: '2023-05-12', rating: 4, tripCount: 1 }),
    );
    expect(content.querySelector('h3')?.textContent).toBe('Zion');
    expect(content.textContent).toContain('Utah');
    expect(content.textContent).toContain('Visited · Last visit May 12, 2023');
    expect(content.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe(
      'Rated 4 out of 5',
    );
    expect(content.querySelector('a')?.getAttribute('href')).toBe('/parks/zion/');
    expect(content.querySelector('.park-popup__status--visited')).not.toBeNull();
  });

  it('shows a park not visited, without a rating', () => {
    const content = buildPopupContent(makeSummary());
    expect(content.textContent).toContain('Not visited yet');
    expect(content.querySelector('[role="img"]')).toBeNull();
    expect(content.querySelector('.park-popup__status')?.className).toBe('park-popup__status');
  });

  it('writes names as text, never as HTML', () => {
    const content = buildPopupContent(makeSummary({ name: '<img src=x onerror=alert(1)>' }));
    expect(content.querySelector('img')).toBeNull();
    expect(content.querySelector('h3')?.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('says "Visited" when the visit has no date', () => {
    expect(getVisitLine(makeSummary({ isVisited: true }))).toBe('Visited');
  });
});
