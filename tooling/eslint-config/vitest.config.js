import { createVitestConfig } from '@vprprudhvi/tooling-vitest-config';

export default createVitestConfig({ coverageExclude: ['src/**/*.test.js'] });
