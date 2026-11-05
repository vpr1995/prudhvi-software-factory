import { fileURLToPath } from 'node:url';

import { createAppVitestConfig } from '@vprprudhvi/tooling-vitest-config';

// The shared app preset gives the settings, the thresholds and the coverage globs. `web` adds the
// jsdom test set for test/web. Playwright runs the specs in web/e2e, so Vitest skips them.
// web/lib/data.ts imports the visits file through the `@npt/visits` alias (next.config.ts sets it
// for the build). The tests use the real file, like the production build.
export default createAppVitestConfig({
  web: true,
  alias: {
    '@npt/visits': fileURLToPath(new URL('web/data/visits.json', import.meta.url)),
  },
});
