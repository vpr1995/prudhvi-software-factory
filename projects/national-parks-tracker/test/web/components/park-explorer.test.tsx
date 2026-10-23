import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ParkExplorer } from '../../../web/components/park-explorer';
import { fixtureSummaries } from '../fixtures';

vi.mock('../../../web/components/park-map', async () => {
  const stub = await import('./park-map-stub');
  return { ParkMap: stub.ParkMapStub };
});

const scrollIntoView = vi.fn();

/**
 * Sets the result of `matchMedia`: mobile or desktop, and reduced motion.
 *
 * @param options - The media state.
 * @param options.isMobile - True for a narrow screen.
 * @param options.isReduced - True when reduced motion is on.
 */
function stubMedia(options: { isMobile: boolean; isReduced: boolean }): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('reduced-motion') ? options.isReduced : options.isMobile,
      media: query,
    })),
  );
}

const rows = () => within(screen.getByRole('list', { name: 'Parks' })).getAllByRole('listitem');
const rowNames = () => rows().map((row) => within(row).getByRole('heading').textContent);

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  stubMedia({ isMobile: false, isReduced: false });
  Element.prototype.scrollIntoView = scrollIntoView;
  scrollIntoView.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ParkExplorer', () => {
  it('lists all 64 parks with the count', async () => {
    render(<ParkExplorer parks={fixtureSummaries} />);
    expect(rows()).toHaveLength(64);
    expect(screen.getByText('Showing 64 of 64 parks')).toBeInTheDocument();
    expect(await screen.findByText('Map markers: 64')).toBeInTheDocument();
  });

  it('filters by search and keeps the search in the URL', async () => {
    const user = userEvent.setup();
    render(<ParkExplorer parks={fixtureSummaries} />);
    await user.type(screen.getByRole('searchbox', { name: 'Search parks' }), 'utah');
    expect(rowNames()).toEqual(['Arches', 'Bryce Canyon', 'Canyonlands', 'Capitol Reef', 'Zion']);
    expect(screen.getByText('Showing 5 of 64 parks')).toBeInTheDocument();
    expect(window.location.search).toBe('?q=utah');
    expect(await screen.findByText('Map markers: 5')).toBeInTheDocument();
  });

  it('shows the counts on the status filter and filters by status', async () => {
    const user = userEvent.setup();
    render(<ParkExplorer parks={fixtureSummaries} />);
    expect(screen.getByRole('radio', { name: 'Visited (8)' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Not yet (56)' })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Visited (8)' }));
    expect(rows()).toHaveLength(8);
    expect(window.location.search).toBe('?status=visited');
  });

  it('sorts by rating', async () => {
    const user = userEvent.setup();
    render(<ParkExplorer parks={fixtureSummaries} />);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'Rating');
    expect(rowNames().slice(0, 2)).toEqual(['Hawaiʻi Volcanoes', 'Zion']);
    expect(window.location.search).toBe('?sort=rating');
  });

  it('shows the empty state, and "Clear filters" brings the list back but keeps the sort', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/?q=xyzzy&status=visited&sort=rating');
    render(<ParkExplorer parks={fixtureSummaries} />);
    expect(screen.getByText('No parks match your search and filter.')).toBeInTheDocument();
    expect(screen.getByText('Showing 0 of 64 parks')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(rows()).toHaveLength(64);
    expect(window.location.search).toBe('?sort=rating');
  });

  it('reads the state from the URL and ignores invalid values', () => {
    window.history.replaceState(null, '', '/?q=hawaii&status=bad&sort=nope');
    render(<ParkExplorer parks={fixtureSummaries} />);
    expect(screen.getByRole('searchbox', { name: 'Search parks' })).toHaveValue('hawaii');
    expect(screen.getByRole('radio', { name: 'All (2)' })).toBeChecked();
    expect(screen.getByRole('combobox', { name: 'Sort by' })).toHaveValue('name');
  });

  it('follows the browser history', () => {
    render(<ParkExplorer parks={fixtureSummaries} />);
    act(() => {
      window.history.pushState(null, '', '/?q=alaska');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(rows()).toHaveLength(8);
  });

  it('selects a park from the list, and scrolls to the map on a narrow screen only', async () => {
    const user = userEvent.setup();
    render(<ParkExplorer parks={fixtureSummaries} />);
    await screen.findByTestId('map');
    await user.click(screen.getByRole('button', { name: 'Show Zion on map' }));
    expect(screen.getByText('Map selection: zion from list')).toBeInTheDocument();
    expect(scrollIntoView).not.toHaveBeenCalled();
    const zionRow = rows().find((row) => row.textContent.includes('Zion'));
    expect(zionRow).toHaveAttribute('aria-current', 'true');

    stubMedia({ isMobile: true, isReduced: true });
    await user.click(screen.getByRole('button', { name: 'Show Acadia on map' }));
    expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: 'auto', block: 'start' });
    stubMedia({ isMobile: true, isReduced: false });
    await user.click(screen.getByRole('button', { name: 'Show Arches on map' }));
    expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: 'smooth', block: 'start' });
  });

  it('selects a park from the map and changes the view with the region buttons', async () => {
    const user = userEvent.setup();
    render(<ParkExplorer parks={fixtureSummaries} />);
    await user.click(await screen.findByRole('button', { name: 'Click the Zion marker' }));
    expect(screen.getByText('Map selection: zion from map')).toBeInTheDocument();
    const alaska = screen.getByRole('button', { name: 'Alaska' });
    await user.click(alaska);
    expect(alaska).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Map view: alaska')).toBeInTheDocument();
  });
});
