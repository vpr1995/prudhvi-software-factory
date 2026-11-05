// Entry point for `rush add-part` (common/config/rush/command-line.json).
// Run: node common/scripts/install-run-rush.js add-part --project <name> --part <node|web|infra>
import { runAddPart } from '../src/cli.js';

import { context } from './context.mjs';

process.exitCode = await runAddPart(process.argv.slice(2), context);
