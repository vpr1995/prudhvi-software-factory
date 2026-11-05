import { base, fsIoException, node, test } from '@vprprudhvi/tooling-eslint-config';

// The root config holds the same exception for this file (tooling/eslint-config/src/monorepo.js).
export default [...base, ...node, ...test, fsIoException(['src/fs-io.js'])];
