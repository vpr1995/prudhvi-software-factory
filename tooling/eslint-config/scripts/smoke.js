// Build step for this package: prove every exported config loads and has the expected shape.
import assert from 'node:assert/strict';

import { base, boundaries, cdk, next, node, react, test } from '../src/index.js';

const arrays = { base, boundaries: boundaries(), cdk, next, node, react, test };
for (const [name, config] of Object.entries(arrays)) {
  assert.ok(Array.isArray(config) && config.length > 0, `${name} must be a non-empty array`);
}
process.stdout.write(`ok: ${Object.keys(arrays).length} configs load\n`);
