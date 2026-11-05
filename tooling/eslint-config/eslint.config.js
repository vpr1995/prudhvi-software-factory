import { base, fsIoException, node, test } from './src/index.js';

// The root config holds the same exception for this file (src/monorepo.js).
export default [...base, ...node, ...test, fsIoException(['scripts/fs-io.mjs'])];
