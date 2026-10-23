import Link from 'next/link';

import { SiteHeader } from '../components/site-header';

/**
 * The page for an unknown path. The static export writes it to 404.html.
 *
 * @returns The page.
 */
export default function NotFound(): React.JSX.Element {
  return (
    <>
      <SiteHeader />
      <main id="main" className="page not-found">
        <h1>This trail does not go anywhere</h1>
        <p>We could not find that page. It may have moved, or the address may have a typo.</p>
        <p>
          <Link href="/" className="button-link">
            Go to the map of all parks
          </Link>
        </p>
      </main>
    </>
  );
}
