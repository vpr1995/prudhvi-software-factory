import { base, boundaries, node, test } from '@vprprudhvi/tooling-eslint-config';

const REPO_ROOT = new URL('../../', import.meta.url).pathname;

// This package is the only one that may import the OpenTelemetry SDK, so it has no import guard.
export default [...base, ...node, ...test, ...boundaries({ rootPath: REPO_ROOT })];
