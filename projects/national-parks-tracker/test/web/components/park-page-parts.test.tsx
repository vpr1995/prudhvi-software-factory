import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ParkFacts } from '../../../web/components/park-facts';
import { ParkPager } from '../../../web/components/park-pager';
import { ProgressSummary } from '../../../web/components/progress-summary';
import { RatingStars } from '../../../web/components/rating-stars';
import { SiteHeader } from '../../../web/components/site-header';
import { VisitDetails } from '../../../web/components/visit-details';
import { computeStats } from '../../../web/lib/stats';
import { fixtureData, fixtureSummaries } from '../fixtures';

const parkOf = (id: string) => {
  const park = fixtureData.parks.find((candidate) => candidate.id === id);
  if (park === undefined) {
    throw new Error(id);
  }
  return park;
};

describe('VisitDetails', () => {
  it('shows a full visit: trips newest first, the rating, the notes, the places and the photos', () => {
    render(<VisitDetails parkName="Zion" visit={fixtureData.visits['zion']} />);
    expect(screen.getByText('1 trip')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Rated 5 out of 5' })).toHaveTextContent('★★★★★');
    expect(screen.getByRole('heading', { name: 'What we liked' })).toBeInTheDocument();
    expect(screen.getByText(/Golden light on the canyon walls/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What we did' })).toBeInTheDocument();
    const places = screen.getByRole('heading', { name: 'Places to go' }).parentElement;
    expect(
      within(places ?? document.body)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Observation Point', 'Kolob Canyons']);
    expect(screen.getAllByRole('figure')).toHaveLength(2);
    expect(screen.getByText('The Narrows, day two')).toBeInTheDocument();
  });

  it('lists the trips newest first', () => {
    render(<VisitDetails parkName="Yosemite" visit={fixtureData.visits['yosemite']} />);
    const trips = within(screen.getByRole('list', { name: 'Trips, newest first' })).getAllByRole(
      'listitem',
    );
    expect(trips.map((trip) => trip.textContent)).toEqual([
      'Aug 1–3, 2025',
      'Sep 20, 2021',
      'Jun 2–5, 2018',
    ]);
    expect(screen.getByText('3 trips')).toBeInTheDocument();
  });

  it('leaves out every missing field', () => {
    const { container } = render(
      <VisitDetails
        parkName="Yosemite"
        visit={{ trips: [{ start: '2019-10' }], placesToGo: [], photos: [] }}
      />,
    );
    expect(screen.getAllByRole('heading').map((heading) => heading.textContent)).toEqual(['Trips']);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(container.textContent).not.toContain('undefined');
  });

  it('shows a friendly card for a park not visited', () => {
    render(<VisitDetails parkName="Chiricahua" visit={undefined} />);
    expect(screen.getByText('Not visited yet')).toBeInTheDocument();
    expect(screen.getByText(/Chiricahua is still on the list/)).toBeInTheDocument();
  });
});

describe('ParkFacts', () => {
  it('shows the facts and a new-tab link to nps.gov', () => {
    render(<ParkFacts park={parkOf('chiricahua')} />);
    expect(screen.getByText('October 20, 2026')).toBeInTheDocument();
    expect(screen.getByText('State')).toBeInTheDocument();
    expect(screen.getByText('Arizona')).toBeInTheDocument();
    expect(screen.getByText(/acres \(/)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Chiricahua on nps.gov (opens in a new tab)' });
    expect(link).toHaveAttribute('href', 'https://www.nps.gov/chir/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('says "States" for a park in several states', () => {
    render(<ParkFacts park={parkOf('death-valley')} />);
    expect(screen.getByText('States')).toBeInTheDocument();
    expect(screen.getByText('California, Nevada')).toBeInTheDocument();
  });
});

describe('ParkPager', () => {
  it('links to the previous and next parks and back to the map', () => {
    render(<ParkPager previous={parkOf('zion')} next={parkOf('american-samoa')} />);
    const nav = screen.getByRole('navigation', { name: 'Park pages' });
    expect(within(nav).getByRole('link', { name: /Previous park/ })).toHaveAttribute(
      'href',
      '/parks/zion/',
    );
    expect(within(nav).getByRole('link', { name: /Next park/ })).toHaveAttribute(
      'href',
      '/parks/american-samoa/',
    );
    expect(within(nav).getByRole('link', { name: 'Back to map' })).toHaveAttribute('href', '/');
  });

  it('leaves out missing neighbors', () => {
    render(<ParkPager previous={undefined} next={undefined} />);
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });
});

describe('header parts', () => {
  it('shows the progress of the fixture visits', () => {
    render(<ProgressSummary stats={computeStats(fixtureSummaries)} />);
    expect(screen.getByText(/of 64 parks visited/)).toHaveTextContent('8 of 64 parks visited');
    expect(screen.getByRole('progressbar', { name: '8 of 64 parks visited' })).toHaveAttribute(
      'value',
      '8',
    );
    expect(screen.getByRole('link', { name: 'Yosemite' })).toHaveAttribute(
      'href',
      '/parks/yosemite/',
    );
    expect(screen.getByText(/Aug 1, 2025/)).toBeInTheDocument();
  });

  it('says "None yet" before the first visit', () => {
    render(<ProgressSummary stats={computeStats([])} />);
    expect(screen.getByText('None yet')).toBeInTheDocument();
  });

  it('uses the title as the main heading on the home page only', () => {
    const { unmount } = render(<SiteHeader isHome />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'National Parks Tracker' }),
    ).toBeInTheDocument();
    unmount();
    render(<SiteHeader />);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'National Parks Tracker' })).toHaveAttribute(
      'href',
      '/',
    );
  });

  it('draws large rating stars with a text for screen readers', () => {
    render(<RatingStars rating={3} size="large" />);
    expect(screen.getByRole('img', { name: 'Rated 3 out of 5' })).toHaveTextContent('★★★☆☆');
  });
});
