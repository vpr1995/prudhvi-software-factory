// Entry point for `rush new` (common/config/rush/command-line.json).
// Run: node common/scripts/install-run-rush.js new --library <name>
//      node common/scripts/install-run-rush.js new --project <name>
import { run } from '../src/cli.js';

import { context } from './context.mjs';

process.exitCode = await run(process.argv.slice(2), context);
