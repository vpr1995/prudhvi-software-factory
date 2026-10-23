import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ParkFacts } from '../../../components/park-facts';
import { ParkHero } from '../../../components/park-hero';
import { ParkPager } from '../../../components/park-pager';
import { SiteHeader } from '../../../components/site-header';
import { VisitDetails } from '../../../components/visit-details';
import { siteData } from '../../../lib/data';
import { getNeighbors } from '../../../lib/park-view';
import { formatStateNames } from '../../../lib/states';

// Only the 64 parks exist. The static export writes one page for each id from generateStaticParams,
// and the host serves 404.html for any other id. The `dynamicParams = false` segment option is left
// out on purpose: the repo naming rule wants an is/has prefix on booleans, and Next.js accepts only a
// literal `export const dynamicParams`. With `output: 'export'` there is no server to render other
// ids, so the result is the same.

/** Props of the park page. */
type ParkPageProps = {
  readonly params: Promise<{ readonly id: string }>;
};

/**
 * Lists every park id, so the export writes one page for each park.
 *
 * @returns The ids.
 */
export function generateStaticParams(): { id: string }[] {
  return siteData.parks.map((park) => ({ id: park.id }));
}

const findPark = (id: string): (typeof siteData.parks)[number] | undefined =>
  siteData.parks.find((park) => park.id === id);

/**
 * Builds the title and description of a park page.
 *
 * @param props - The route params.
 * @returns The metadata.
 */
export async function generateMetadata(props: ParkPageProps): Promise<Metadata> {
  const { id } = await props.params;
  const park = findPark(id);
  if (park === undefined) {
    return {};
  }
  const status = siteData.visits[id] === undefined ? 'Not visited yet' : 'Visited';
  return {
    title: `${park.name} · National Parks Tracker`,
    description: `${park.fullName} in ${formatStateNames(park.states)}. ${status}. ${park.description}`,
  };
}

/**
 * The page of one park: photo, visit details, facts and links to the other parks.
 *
 * @param props - The route params.
 * @returns The page.
 */
export default async function ParkPage(props: ParkPageProps): Promise<React.JSX.Element> {
  const { id } = await props.params;
  const park = findPark(id);
  if (park === undefined) {
    notFound();
  }
  const visit = siteData.visits[id];
  const { previous, next } = getNeighbors(siteData.parks, id);
  return (
    <>
      <SiteHeader />
      <main id="main" className="page park-page">
        <p className="back-link">
          <Link href="/">
            <span aria-hidden="true">← </span>Back to map
          </Link>
        </p>
        <h1 className="park-title">{park.fullName}</h1>
        <p className="park-subtitle">{formatStateNames(park.states)}</p>
        <ParkHero
          parkName={park.name}
          photo={siteData.photos[id]}
          ownerPhoto={visit?.photos?.[0]}
        />
        <div className="park-columns">
          <section aria-labelledby="visit-heading" className="park-section">
            <h2 id="visit-heading">Our visits</h2>
            <VisitDetails parkName={park.name} visit={visit} />
          </section>
          <section aria-labelledby="about-heading" className="park-section">
            <h2 id="about-heading">About the park</h2>
            <p className="park-description">{park.description}</p>
            <ParkFacts park={park} />
          </section>
        </div>
        <ParkPager previous={previous} next={next} />
      </main>
    </>
  );
}
