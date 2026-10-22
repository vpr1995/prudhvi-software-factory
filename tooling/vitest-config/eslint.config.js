// Relative import on purpose: @vprprudhvi/tooling-eslint-config depends on this package for its tests,
// so a package dependency in this direction would create a cycle.
import { base, node, test } from '../eslint-config/src/index.js';

export default [...base, ...node, ...test];
