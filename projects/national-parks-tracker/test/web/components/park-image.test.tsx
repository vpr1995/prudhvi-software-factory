import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ParkHero } from '../../../web/components/park-hero';
import { ParkImage } from '../../../web/components/park-image';
import { fixtureData } from '../fixtures';

const WIKIMEDIA = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Zion.jpg';

describe('ParkImage', () => {
  it('tries each source in order, then shows the placeholder', () => {
    const onSourceChange = vi.fn();
    render(
      <ParkImage
        variant="hero"
        placeholderLabel="No photo of Zion"
        onSourceChange={onSourceChange}
        sources={[
          { src: WIKIMEDIA, alt: 'Zion canyon' },
          { src: '/photos/zion/narrows.jpg', alt: 'The Narrows' },
        ]}
      />,
    );
    fireEvent.error(screen.getByRole('img', { name: 'Zion canyon' }));
    expect(onSourceChange).toHaveBeenLastCalledWith(1);
    fireEvent.error(screen.getByRole('img', { name: 'The Narrows' }));
    expect(onSourceChange).toHaveBeenLastCalledWith(-1);
    expect(screen.getByRole('img', { name: 'No photo of Zion' })).toHaveTextContent('No photo yet');
  });

  it('notices an image that failed before hydration', () => {
    const complete = vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
    render(
      <ParkImage
        variant="gallery"
        placeholderLabel="Photo not found: a bear"
        sources={[{ src: '/photos/a/b.jpg', alt: 'A bear' }]}
      />,
    );
    expect(screen.getByRole('img', { name: 'Photo not found: a bear' })).toHaveTextContent(
      'Photo not found',
    );
    complete.mockRestore();
  });

  it('loads a gallery image lazily', () => {
    render(
      <ParkImage
        variant="gallery"
        placeholderLabel="x"
        sources={[{ src: '/photos/a/b.jpg', alt: 'A bear' }]}
      />,
    );
    expect(screen.getByRole('img', { name: 'A bear' })).toHaveAttribute('loading', 'lazy');
  });

  it('hides the placeholder of a thumbnail from screen readers', () => {
    const { container } = render(
      <ParkImage variant="thumbnail" placeholderLabel="Zion" sources={[]} />,
    );
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });
});

const requirePhoto = (id: string) => {
  const photo = fixtureData.photos[id];
  if (photo === undefined) {
    throw new Error(`The data has no photo of ${id}.`);
  }
  return photo;
};

describe('ParkHero', () => {
  // Crater Lake has one of the longest credits.
  const photo = requirePhoto('crater-lake');

  it('shows the Wikimedia photo with the credit and license links', () => {
    render(<ParkHero parkName="Crater Lake" photo={photo} ownerPhoto={undefined} />);
    expect(screen.getByRole('img', { name: photo.alt })).toHaveAttribute('loading', 'eager');
    const credit = screen.getByRole('link', { name: photo.credit });
    expect(credit).toHaveAttribute('href', photo.sourceUrl);
    expect(credit).toHaveAttribute('title', photo.credit);
    expect(screen.getByText(/^Photo:/)).toHaveTextContent(
      `Photo: ${photo.credit} · ${photo.license}`,
    );
  });

  it('shows the license as text when it has no link', () => {
    const { licenseUrl: _licenseUrl, ...noLink } = photo;
    render(<ParkHero parkName="Crater Lake" photo={noLink} ownerPhoto={undefined} />);
    expect(screen.queryByRole('link', { name: photo.license })).not.toBeInTheDocument();
    expect(screen.getByText(/^Photo:/)).toHaveTextContent(photo.license);
  });

  it('falls back to the owner photo with its caption, then to the placeholder', () => {
    render(
      <ParkHero
        parkName="Zion"
        photo={photo}
        ownerPhoto={{ src: '/photos/zion/narrows.jpg', alt: 'The Narrows', caption: 'Day two' }}
      />,
    );
    fireEvent.error(screen.getByRole('img', { name: photo.alt }));
    expect(screen.getByRole('img', { name: 'The Narrows' })).toBeInTheDocument();
    expect(screen.getByText('Day two')).toBeInTheDocument();
    expect(screen.queryByText(/^Photo:/)).not.toBeInTheDocument();
    fireEvent.error(screen.getByRole('img', { name: 'The Narrows' }));
    expect(screen.getByRole('img', { name: 'Zion' })).toHaveTextContent('No photo yet');
    expect(screen.queryByText('Day two')).not.toBeInTheDocument();
  });

  it('shows the placeholder when there is no photo at all', () => {
    render(<ParkHero parkName="Zion" photo={undefined} ownerPhoto={undefined} />);
    expect(screen.getByRole('img', { name: 'Zion' })).toBeInTheDocument();
    expect(screen.queryByRole('figure')?.querySelector('figcaption')).toBeFalsy();
  });
});
