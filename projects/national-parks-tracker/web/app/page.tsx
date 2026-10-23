import { ParkExplorer } from '../components/park-explorer';
import { ProgressSummary } from '../components/progress-summary';
import { SiteHeader } from '../components/site-header';
import { siteData } from '../lib/data';
import { buildParkSummaries } from '../lib/park-view';
import { computeStats } from '../lib/stats';

/**
 * The home page: header with progress, the park list and the map. Built once at build time.
 *
 * @returns The page.
 */
export default function HomePage(): React.JSX.Element {
  const parks = buildParkSummaries(siteData);
  return (
    <div className="home">
      <SiteHeader isHome>
        <ProgressSummary stats={computeStats(parks)} />
      </SiteHeader>
      <main id="main" className="home-main">
        <ParkExplorer parks={parks}>
          <p className="credits">
            Park facts and photos: Wikipedia, Wikimedia Commons and the National Park Service. Each
            park page names the photographer and the license.
          </p>
        </ParkExplorer>
      </main>
    </div>
  );
}
