import { createAppVitestConfig } from '@vprprudhvi/tooling-vitest-config';

// The shared app preset gives the settings, the thresholds and the coverage globs. `web` adds the
// jsdom test set for test/web. Playwright runs the specs in web/e2e, so Vitest skips them.
export default createAppVitestConfig({ web: true });
