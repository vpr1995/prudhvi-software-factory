// Build time only: Server Components import this module while `next build` renders the pages.
// The visits file comes through the `@npt/visits` alias, so NPT_VISITS_FILE can point the build at
// the e2e fixture (see next.config.ts). No file is read at run time: the site is static.
import { posix } from 'node:path';

import visitsJson from '@npt/visits';

import { loadWebConfig } from '../config';
import parksJson from '../data/parks.json';
import photosJson from '../data/photos.json';

import { DEFAULT_SITE_DATA_FILES, parseSiteData } from './site-data';
import type { SiteData } from './site-data';

const config = loadWebConfig();

/** The validated data of the site. */
export const siteData: SiteData = parseSiteData(
  { parks: parksJson, photos: photosJson, visits: visitsJson },
  { files: { ...DEFAULT_SITE_DATA_FILES, visits: posix.normalize(`web/${config.visitsFile}`) } },
);
