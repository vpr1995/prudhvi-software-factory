import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { MapPanel } from '../../../web/components/map-panel';
import type { MapPanelProps } from '../../../web/components/map-panel';
import { fixtureSummaries } from '../fixtures';

vi.mock('../../../web/components/park-map', async () => {
  const stub = await import('./park-map-stub');
  return { ParkMap: stub.ParkMapStub };
});

const renderPanel = (overrides: Partial<MapPanelProps> = {}) => {
  const props: MapPanelProps = {
    parks: fixtureSummaries,
    allParks: fixtureSummaries,
    selection: undefined,
    viewRequest: { view: 'lower48', token: 0 },
    onViewChange: vi.fn(),
    onSelect: vi.fn(),
    ...overrides,
  };
  const result = render(<MapPanel {...props} />);
  const rerender = (next: Partial<MapPanelProps>): void => {
    result.rerender(<MapPanel {...props} {...next} />);
  };
  return { ...props, rerender };
};

describe('MapPanel', () => {
  it('shows a loading text, then the map with the region buttons, the legend and the attribution', async () => {
    renderPanel();
    expect(screen.getByText('Loading the map…')).toBeInTheDocument();
    expect(await screen.findByTestId('map')).toBeInTheDocument();
    const names = screen
      .getAllByRole('button', { pressed: false })
      .map((button) => button.textContent);
    expect(names).toEqual(['Alaska', 'Hawaii', 'American Samoa', 'Virgin Islands', 'All parks']);
    expect(screen.getByRole('button', { name: 'Lower 48', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Map legend' })).toHaveTextContent('Visited');
    expect(screen.getByRole('link', { name: 'OpenStreetMap' })).toHaveAttribute(
      'href',
      'https://www.openstreetmap.org/copyright',
    );
  });

  it('asks for a view when a region button is pressed', async () => {
    const user = userEvent.setup();
    const props = renderPanel();
    await user.click(screen.getByRole('button', { name: 'All parks' }));
    expect(props.onViewChange).toHaveBeenCalledWith('all');
  });

  it('shows the tile banner in a live region that is always there', async () => {
    const user = userEvent.setup();
    renderPanel();
    const banner = screen.getByRole('status');
    expect(banner).toBeEmptyDOMElement();
    await user.click(await screen.findByRole('button', { name: 'Fail the tiles' }));
    expect(banner).toHaveTextContent('Map tiles could not load. Use the list.');
    await user.click(screen.getByRole('button', { name: 'Load the tiles again' }));
    expect(screen.getByRole('status')).toBe(banner);
    expect(banner).toBeEmptyDOMElement();
  });

  it('shows a region button pressed only while the map shows its view', async () => {
    const user = userEvent.setup();
    const { rerender } = renderPanel();
    await user.click(await screen.findByRole('button', { name: 'Drag the map' }));
    expect(screen.queryByRole('button', { pressed: true })).not.toBeInTheDocument();
    rerender({ viewRequest: { view: 'alaska', token: 1 } });
    expect(screen.getByRole('button', { name: 'Alaska', pressed: true })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Drag the map' }));
    expect(screen.queryByRole('button', { pressed: true })).not.toBeInTheDocument();
    // The same button again is a new request, so it shows pressed again.
    rerender({ viewRequest: { view: 'alaska', token: 2 } });
    expect(screen.getByRole('button', { name: 'Alaska', pressed: true })).toBeInTheDocument();
  });

  it('tells how many parks are outside the view, with a jump for each region', async () => {
    const user = userEvent.setup();
    const props = renderPanel();
    await user.click(await screen.findByRole('button', { name: 'Move the map' }));
    expect(screen.getByText('+9 parks outside this view:')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hawaii (0)' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Alaska (8)' }));
    expect(props.onViewChange).toHaveBeenCalledWith('alaska');
    await user.click(screen.getByRole('button', { name: 'American Samoa (1)' }));
    expect(props.onViewChange).toHaveBeenCalledWith('american-samoa');
    await user.click(screen.getByRole('button', { name: 'Move the map to show all but one' }));
    expect(screen.getByText('+1 park outside this view:')).toBeInTheDocument();
  });
});
