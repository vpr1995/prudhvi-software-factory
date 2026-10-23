import { z } from 'zod';

import { strictObject, text } from './messages.ts';

const MAX_NAME_LENGTH = 80;
const MAX_FULL_NAME_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 1000;
const MAX_ALT_LENGTH = 300;
const MAX_CREDIT_LENGTH = 400;
const MAX_LICENSE_LENGTH = 80;
const MAX_LATITUDE = 90;
const MAX_LONGITUDE = 180;

/**
 * Two-letter codes of the 50 states, DC, American Samoa and the US Virgin Islands. Each code has a
 * map region with a view button (`web/lib/regions.ts`). Add a territory only together with its region.
 */
export const STATE_CODES = [
  'AL',
  'AK',
  'AZ',
  'AR',
  'CA',
  'CO',
  'CT',
  'DE',
  'FL',
  'GA',
  'HI',
  'ID',
  'IL',
  'IN',
  'IA',
  'KS',
  'KY',
  'LA',
  'ME',
  'MD',
  'MA',
  'MI',
  'MN',
  'MS',
  'MO',
  'MT',
  'NE',
  'NV',
  'NH',
  'NJ',
  'NM',
  'NY',
  'NC',
  'ND',
  'OH',
  'OK',
  'OR',
  'PA',
  'RI',
  'SC',
  'SD',
  'TN',
  'TX',
  'UT',
  'VT',
  'VA',
  'WA',
  'WV',
  'WI',
  'WY',
  'DC',
  'AS',
  'VI',
] as const;

/** A state or territory code, for example `UT`. */
export const StateCodeSchema = z.enum(STATE_CODES, {
  error:
    'Use a two-letter state code in capitals, for example "UT". The territories are "AS" and "VI".',
});

/** A state or territory code, for example `UT`. */
export type StateCode = z.infer<typeof StateCodeSchema>;

/** A park id: lowercase words joined by dashes, for example `great-smoky-mountains`. */
export const ParkIdSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9-]*[a-z0-9]$/,
    'Use lowercase letters, digits and dashes, for example "zion".',
  );

/** A park id, for example `zion`. */
export type ParkId = z.infer<typeof ParkIdSchema>;

/** A calendar date `YYYY-MM-DD` that exists, for example `1919-02-26` (not `2023-02-30`). */
export const CalendarDateSchema = z
  .string({ error: 'Write the date in double quotes, for example "1919-02-26".' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the form YYYY-MM-DD, for example 1919-02-26.')
  .refine(
    (value) => {
      const [year = 0, month = 0, day = 0] = value.split('-').map(Number);
      const date = new Date(Date.UTC(year, month - 1, day));
      return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
    },
    { message: 'This date does not exist in the calendar.' },
  );

/** Map position in decimal degrees. */
const LATITUDE_MESSAGE = `Use a latitude from -${String(MAX_LATITUDE)} to ${String(MAX_LATITUDE)} in decimal degrees, for example 37.3.`;
const LONGITUDE_MESSAGE = `Use a longitude from -${String(MAX_LONGITUDE)} to ${String(MAX_LONGITUDE)} in decimal degrees, for example -113.05.`;

export const CoordinatesSchema = strictObject(
  {
    lat: z
      .number({ error: LATITUDE_MESSAGE })
      .min(-MAX_LATITUDE, LATITUDE_MESSAGE)
      .max(MAX_LATITUDE, LATITUDE_MESSAGE),
    lng: z
      .number({ error: LONGITUDE_MESSAGE })
      .min(-MAX_LONGITUDE, LONGITUDE_MESSAGE)
      .max(MAX_LONGITUDE, LONGITUDE_MESSAGE),
  },
  'the coordinates',
);

const AREA_MESSAGE =
  'Use the area in acres as a whole number above 0, without quotes, for example 147243.';
const PIXELS_MESSAGE = 'Use the size in pixels as a whole number above 0, for example 1280.';

/** One national park. */
export const ParkSchema = strictObject(
  {
    id: ParkIdSchema,
    name: text(MAX_NAME_LENGTH, 'Write the short name, for example "Zion".'),
    fullName: text(MAX_FULL_NAME_LENGTH, 'Write the full name, for example "Zion National Park".'),
    states: z
      .array(StateCodeSchema, { error: 'Write the states as a list, for example ["UT"].' })
      .min(1, 'Add at least one state code, for example ["UT"].'),
    coordinates: CoordinatesSchema,
    established: CalendarDateSchema,
    areaAcres: z.number({ error: AREA_MESSAGE }).int(AREA_MESSAGE).positive(AREA_MESSAGE),
    description: text(MAX_DESCRIPTION_LENGTH, 'Write a short description of the park.'),
    npsCode: z
      .string()
      .regex(/^[a-z]{4}$/, 'Use the four-letter nps.gov site code, for example "zion".'),
  },
  'a park',
);

/** One national park. */
export type Park = z.infer<typeof ParkSchema>;

/** The content of `web/data/parks.json`. */
export const ParksSchema = z
  .array(ParkSchema, { error: 'Write the parks as a list in square brackets [ ].' })
  .min(1, 'Add at least one park.');

const WikimediaUrlSchema = z.url({
  protocol: /^https$/,
  hostname: /^upload\.wikimedia\.org$/,
  error: 'Use an https://upload.wikimedia.org/ link.',
});

/** A Wikimedia Commons photo of a park, with its credit and license. */
export const ParkPhotoSchema = strictObject(
  {
    src: WikimediaUrlSchema,
    thumbSrc: WikimediaUrlSchema,
    width: z.number({ error: PIXELS_MESSAGE }).int(PIXELS_MESSAGE).positive(PIXELS_MESSAGE),
    height: z.number({ error: PIXELS_MESSAGE }).int(PIXELS_MESSAGE).positive(PIXELS_MESSAGE),
    alt: text(MAX_ALT_LENGTH, 'Describe the photo for people who cannot see it.'),
    credit: text(MAX_CREDIT_LENGTH, 'Name the photographer.'),
    license: text(MAX_LICENSE_LENGTH, 'Name the license, for example "CC BY-SA 4.0".'),
    licenseUrl: z
      .url({ protocol: /^https$/, error: 'Use an https:// link to the license.' })
      .optional(),
    sourceUrl: z.url({ protocol: /^https$/, error: 'Use an https:// link to the photo page.' }),
  },
  'a photo',
);

/** A Wikimedia Commons photo of a park. */
export type ParkPhoto = z.infer<typeof ParkPhotoSchema>;

/** The content of `web/data/photos.json`: at most one photo for each park id. */
export const ParkPhotosSchema = z.record(z.string(), ParkPhotoSchema, {
  error:
    'Write the photos as an object with one entry for each park id, for example { "zion": { } }.',
});

/** The content of `web/data/photos.json`. */
export type ParkPhotos = z.infer<typeof ParkPhotosSchema>;
