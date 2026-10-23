import { z } from 'zod';

import { findRepeats, list, strictObject, text } from './messages.ts';

const MAX_TEXT_LENGTH = 2000;
const MAX_PLACE_LENGTH = 120;
const MAX_PLACES = 50;
const MAX_TRIPS = 200;
const MAX_PHOTOS = 60;
const MAX_ALT_LENGTH = 300;
const MAX_CAPTION_LENGTH = 300;
const MAX_PHOTO_PATH_LENGTH = 200;
const MIN_RATING = 1;
const MAX_RATING = 5;
const RATING_MESSAGE = `Use a whole number from ${String(MIN_RATING)} to ${String(MAX_RATING)}, without quotes, for example 4.`;
const LAST_DAY_PLACEHOLDER = '31';
const FIRST_DAY_PLACEHOLDER = '01';

/**
 * Tells whether a `YYYY-MM` or `YYYY-MM-DD` string is a real calendar date.
 *
 * @param value - The date text. Its form is already checked.
 * @returns True when the month (and the day, if given) exist.
 */
function isRealVisitDate(value: string): boolean {
  const [year = 0, month = 0, day = 1] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** A visit date: `YYYY-MM-DD`, or `YYYY-MM` when the day is not known. It must exist in the calendar. */
export const VisitDateSchema = z
  .string({ error: 'Write the date in double quotes, for example "2023-05-12".' })
  .trim()
  .regex(
    /^\d{4}-\d{2}$|^\d{4}-\d{2}-\d{2}$/,
    'Use the form YYYY-MM-DD or YYYY-MM, for example 2023-05-12 or 2019-10.',
  )
  .refine(isRealVisitDate, { message: 'This date does not exist in the calendar.' });

/** A visit date: `YYYY-MM-DD` or `YYYY-MM`. */
export type VisitDate = z.infer<typeof VisitDateSchema>;

// A month-only start counts from the first day of the month and a month-only end to the last day,
// so `{ start: "2023-05-12", end: "2023-05" }` is a valid trip.
const earliestDay = (value: string): string =>
  value.length === 'YYYY-MM'.length ? `${value}-${FIRST_DAY_PLACEHOLDER}` : value;
const latestDay = (value: string): string =>
  value.length === 'YYYY-MM'.length ? `${value}-${LAST_DAY_PLACEHOLDER}` : value;

/** One trip to a park. `end` is optional and is on or after `start`. */
export const TripSchema = strictObject(
  { start: VisitDateSchema, end: VisitDateSchema.optional() },
  'a trip, for example { "start": "2023-05-12" }',
).refine((trip) => trip.end === undefined || latestDay(trip.end) >= earliestDay(trip.start), {
  message: 'The end date must be on or after the start date.',
  path: ['end'],
});

/** One trip to a park. */
export type Trip = z.infer<typeof TripSchema>;

/** The file types of owner photos. */
export const PHOTO_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'] as const;

const hasPhotoExtension = (path: string): boolean =>
  PHOTO_EXTENSIONS.some((extension) => path.toLowerCase().endsWith(extension));

/** A photo that the owner put in `web/public/photos/<park-id>/`. */
export const VisitPhotoSchema = strictObject(
  {
    src: z
      .string({ error: 'Write the path in double quotes, for example "/photos/zion/narrows.jpg".' })
      .trim()
      .max(
        MAX_PHOTO_PATH_LENGTH,
        `Use a path of at most ${String(MAX_PHOTO_PATH_LENGTH)} characters.`,
      )
      .regex(
        /^\/photos\/[\w-]+\/[\w.-]+$/,
        'Use a path like /photos/zion/narrows.jpg. Put the file in web/public/photos/zion/.',
      )
      .refine((value) => !value.includes('..'), { message: 'The path must not contain "..".' })
      .refine(hasPhotoExtension, {
        message: `Use a photo file that ends in ${PHOTO_EXTENSIONS.join(', ')}.`,
      }),
    alt: text(MAX_ALT_LENGTH, 'Describe the photo for people who cannot see it.'),
    caption: text(MAX_CAPTION_LENGTH, 'Write a caption, or remove the field.').optional(),
  },
  'a photo, for example { "src": "/photos/zion/narrows.jpg", "alt": "..." }',
);

/** A photo that the owner took. */
export type VisitPhoto = z.infer<typeof VisitPhotoSchema>;

const NotesSchema = text(MAX_TEXT_LENGTH, 'Remove the field or write some text.');

/** What the owner records about one park. A park with an entry counts as visited. */
export const VisitSchema = strictObject(
  {
    trips: list(TripSchema, MAX_TRIPS, 'trips').min(1, 'Add at least one trip.'),
    rating: z
      .number({ error: RATING_MESSAGE })
      .int(RATING_MESSAGE)
      .min(MIN_RATING, RATING_MESSAGE)
      .max(MAX_RATING, RATING_MESSAGE)
      .optional(),
    liked: NotesSchema.optional(),
    did: NotesSchema.optional(),
    placesToGo: list(
      text(MAX_PLACE_LENGTH, 'Remove empty places.'),
      MAX_PLACES,
      'places to go',
    ).optional(),
    photos: list(VisitPhotoSchema, MAX_PHOTOS, 'photos').optional(),
  },
  'a visit, for example { "trips": [{ "start": "2023-05-12" }] }',
).superRefine((visit, context) => {
  // A repeated entry is a copy-and-paste mistake, and it gives two list items the same React key.
  for (const index of findRepeats(visit.trips, (trip) => `${trip.start}/${trip.end ?? ''}`)) {
    context.addIssue({
      code: 'custom',
      path: ['trips', index],
      message: 'This trip is listed twice. Remove one of them.',
    });
  }
  for (const index of findRepeats(visit.placesToGo ?? [], (place) => place)) {
    context.addIssue({
      code: 'custom',
      path: ['placesToGo', index],
      message: 'This place is listed twice. Remove one of them.',
    });
  }
  for (const index of findRepeats(visit.photos ?? [], (photo) => photo.src)) {
    context.addIssue({
      code: 'custom',
      path: ['photos', index, 'src'],
      message: 'This photo is listed twice. Remove one of them.',
    });
  }
});

/** What the owner records about one park. */
export type Visit = z.infer<typeof VisitSchema>;

/** One entry of `web/data/visits.json`. */
type VisitEntry = { readonly parkId: string; readonly visit: Visit };

/**
 * Adds an issue for each owner photo that is not in the folder of its park.
 *
 * @param entry - The park id and the visit.
 * @param context - The refinement context.
 */
function checkPhotoFolders({ parkId, visit }: VisitEntry, context: z.RefinementCtx): void {
  const folder = `/photos/${parkId}/`;
  for (const [index, photo] of (visit.photos ?? []).entries()) {
    if (!photo.src.startsWith(folder)) {
      context.addIssue({
        code: 'custom',
        path: [parkId, 'photos', index, 'src'],
        message: `Put the photo in the folder of this park: web/public${folder}. Then use a path that starts with ${folder}.`,
      });
    }
  }
}

/**
 * Adds an issue for each trip date after today. A month-only date counts from the first day, so a
 * trip in the current month is valid.
 *
 * @param entry - The park id and the visit.
 * @param today - Today, `YYYY-MM-DD`.
 * @param context - The refinement context.
 */
function checkFutureDates(
  { parkId, visit }: VisitEntry,
  today: string,
  context: z.RefinementCtx,
): void {
  for (const [index, trip] of visit.trips.entries()) {
    for (const field of ['start', 'end'] as const) {
      const value = trip[field];
      if (value !== undefined && earliestDay(value) > today) {
        context.addIssue({
          code: 'custom',
          path: [parkId, 'trips', index, field],
          message: `This date is in the future. Use a date on or before today (${today}).`,
        });
      }
    }
  }
}

/**
 * Makes the schema of `web/data/visits.json`: one entry for each visited park, keyed by park id.
 * It also checks that each owner photo is in the folder of its park, and that no trip date is after
 * `today`.
 *
 * @param today - The build date, `YYYY-MM-DD`. The tests set it, so they do not depend on the clock.
 * @returns The schema.
 */
export function createVisitsSchema(today: string): z.ZodRecord<z.ZodString, typeof VisitSchema> {
  return z
    .record(z.string(), VisitSchema, {
      error:
        'Write the visits as an object with one entry for each park id, for example { "zion": { } }.',
    })
    .superRefine((visits, context) => {
      for (const [parkId, visit] of Object.entries(visits)) {
        checkPhotoFolders({ parkId, visit }, context);
        checkFutureDates({ parkId, visit }, today, context);
      }
    });
}

/** The content of `web/data/visits.json`. */
export type Visits = z.infer<ReturnType<typeof createVisitsSchema>>;
