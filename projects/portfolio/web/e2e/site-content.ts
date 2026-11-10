// The content of the site for the Playwright specs. The specs run in Node, which cannot import a
// JSON file without an import attribute, so the file is read here and parsed with the same contract
// that the build uses (src/contracts/content.ts).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ContentSchema } from '../../src/contracts/content.ts';
import type { Content } from '../../src/contracts/content.ts';

// Playwright runs from the project folder (the Rush phase does).
const CONTENT_PATH = resolve(process.cwd(), 'content/portfolio.json');

/** The validated content of the site, as the build reads it. */
export const siteContent: Content = ContentSchema.parse(
  JSON.parse(readFileSync(CONTENT_PATH, 'utf8')),
);
