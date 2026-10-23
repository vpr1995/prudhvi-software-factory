import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import {
  createVisitsSchema,
  TripSchema,
  VisitDateSchema,
  VisitPhotoSchema,
  VisitSchema,
} from '../../src/contracts/visit.ts';

const TODAY = '2026-10-23';
const RATING = 'Use a whole number from 1 to 5, without quotes, for example 4.';
const VisitsSchema = createVisitsSchema(TODAY);

const VISIT = {
  trips: [{ start: '2023-05-12', end: '2023-05-15' }, { start: '2019-10' }],
  rating: 4,
  liked: 'The Narrows.',
  did: 'Hiked Angels Landing.',
  placesToGo: ['Kolob Canyons'],
  photos: [
    { src: '/photos/zion/narrows.jpg', alt: 'Hikers in a narrow canyon', caption: 'The Narrows' },
  ],
};

/**
 * Gives the path of each issue, joined with dots.
 *
 * @param result - A safeParse result.
 * @returns The issue paths.
 */
function issuePaths(result: z.ZodSafeParseResult<unknown>): string[] {
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
}

/**
 * Gives each issue as `path: message`, so a test checks the place and the fix-it text together.
 *
 * @param result - A safeParse result.
 * @returns The issues.
 */
function issuesOf(result: z.ZodSafeParseResult<unknown>): string[] {
  return result.success
    ? []
    : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
}

describe('VisitDateSchema', () => {
  it.each(['2023-05-12', '2019-10', '2024-02-29'])('accepts %s', (value) => {
    expect(VisitDateSchema.safeParse(value).success).toBe(true);
  });

  it.each(['2023-5-12', '2023-05-12T10:00', '2023-02-29', '2023-13', '2023-00', '12/05/2023'])(
    'rejects %s',
    (value) => {
      expect(VisitDateSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe('TripSchema', () => {
  it('accepts a one-day trip, a range and month-only dates', () => {
    expect(TripSchema.safeParse({ start: '2024-07-04' }).success).toBe(true);
    expect(TripSchema.safeParse({ start: '2022-12-30', end: '2023-01-02' }).success).toBe(true);
    expect(TripSchema.safeParse({ start: '2023-05-12', end: '2023-05' }).success).toBe(true);
    expect(TripSchema.safeParse({ start: '2023-05', end: '2023-05-01' }).success).toBe(true);
  });

  it('rejects an end before the start, on the end field', () => {
    const result = TripSchema.safeParse({ start: '2023-05-15', end: '2023-05-12' });
    expect(issuePaths(result)).toEqual(['end']);
    expect(result.error?.issues[0]?.message).toBe(
      'The end date must be on or after the start date.',
    );
    expect(TripSchema.safeParse({ start: '2023-06', end: '2023-05-31' }).success).toBe(false);
  });
});

describe('VisitPhotoSchema', () => {
  it.each([
    'https://example.com/a.jpg',
    '/photos/zion/../../secret.jpg',
    '/photos/a.jpg',
    '/photos/zion/a b.jpg',
  ])('rejects the path %s', (path) => {
    expect(issuePaths(VisitPhotoSchema.safeParse({ src: path, alt: 'A photo' }))).toContain('src');
  });

  it.each(['/photos/zion/a.gif', '/photos/zion/a.heic', '/photos/zion/a'])(
    'rejects the file type of %s',
    (path) => {
      expect(issuesOf(VisitPhotoSchema.safeParse({ src: path, alt: 'A photo' }))).toEqual([
        'src: Use a photo file that ends in .jpg, .jpeg, .png, .webp.',
      ]);
    },
  );

  it.each([
    '/photos/zion/a.jpg',
    '/photos/zion/a.JPEG',
    '/photos/zion/a.png',
    '/photos/zion/a.webp',
  ])('accepts the file type of %s', (path) => {
    expect(VisitPhotoSchema.safeParse({ src: path, alt: 'A photo' }).success).toBe(true);
  });

  it('says the limit of a long path and a long caption', () => {
    const longPath = `/photos/zion/${'a'.repeat(200)}.jpg`;
    expect(
      issuesOf(VisitPhotoSchema.safeParse({ src: longPath, alt: 'A', caption: 'c'.repeat(301) })),
    ).toEqual([
      'src: Use a path of at most 200 characters.',
      'caption: Use at most 300 characters.',
    ]);
    expect(
      issuesOf(VisitPhotoSchema.safeParse({ src: '/photos/zion/a.jpg', alt: 'A', caption: ' ' })),
    ).toEqual(['caption: Write a caption, or remove the field.']);
  });

  it('asks for alt text', () => {
    const result = VisitPhotoSchema.safeParse({ src: '/photos/zion/a.jpg', alt: ' ' });
    expect(result.error?.issues[0]?.message).toBe(
      'Describe the photo for people who cannot see it.',
    );
  });
});

describe('VisitSchema', () => {
  it('accepts a full visit and a visit with one trip only', () => {
    expect(VisitSchema.parse(VISIT)).toEqual(VISIT);
    expect(VisitSchema.safeParse({ trips: [{ start: '2019-10' }] }).success).toBe(true);
  });

  it.each([
    ['trips', { trips: [] }, 'Add at least one trip.'],
    ['rating', { rating: 0 }, RATING],
    ['rating', { rating: 6 }, RATING],
    ['rating', { rating: 3.5 }, RATING],
    ['rating', { rating: '4' }, RATING],
    ['liked', { liked: '   ' }, 'Remove the field or write some text.'],
    ['liked', { liked: 'x'.repeat(2001) }, 'Use at most 2000 characters.'],
    ['placesToGo.0', { placesToGo: [''] }, 'Remove empty places.'],
    [
      'placesToGo',
      { placesToGo: 'Kolob' },
      'Write the places to go as a list in square brackets [ ].',
    ],
    [
      'photos.0.src',
      { photos: [{ src: '/x.jpg', alt: 'x' }] },
      'Use a path like /photos/zion/narrows.jpg. Put the file in web/public/photos/zion/.',
    ],
  ])('rejects a bad %s with a message that says how to fix it', (path, change, message) => {
    expect(issuesOf(VisitSchema.safeParse({ ...VISIT, ...change }))).toContain(
      `${path}: ${message}`,
    );
  });

  it.each([
    {
      field: 'trips',
      message: 'Use at most 200 trips.',
      items: Array.from({ length: 201 }, (_unused, index) => ({
        start: `${String(1800 + index)}-01`,
      })),
    },
    {
      field: 'placesToGo',
      message: 'Use at most 50 places to go.',
      items: Array.from({ length: 51 }, (_unused, index) => `Place ${String(index)}`),
    },
    {
      field: 'photos',
      message: 'Use at most 60 photos.',
      items: Array.from({ length: 61 }, (_unused, index) => ({
        src: `/photos/zion/p${String(index)}.jpg`,
        alt: 'A photo',
      })),
    },
  ])('says the limit of a long $field list', ({ field, message, items }) => {
    expect(issuesOf(VisitSchema.safeParse({ ...VISIT, [field]: items }))).toEqual([
      `${field}: ${message}`,
    ]);
  });

  it('names an unknown key, for example a typo, and lists the allowed keys', () => {
    expect(issuesOf(VisitSchema.safeParse({ ...VISIT, ratng: 4 }))).toEqual([
      ': Remove or rename the unknown field "ratng". The allowed fields are "trips", "rating", "liked", "did", "placesToGo", "photos".',
    ]);
    expect(issuesOf(TripSchema.safeParse({ start: '2020-01', stop: '2020-02' }))).toEqual([
      ': Remove or rename the unknown field "stop". The allowed fields are "start", "end".',
    ]);
    expect(issuesOf(VisitSchema.safeParse('zion'))).toEqual([
      ': Write a visit, for example { "trips": [{ "start": "2023-05-12" }] } as an object in curly braces { }.',
    ]);
  });

  it('rejects repeated trips, places and photos, which would repeat a React key', () => {
    const photo = { src: '/photos/zion/narrows.jpg', alt: 'A' };
    const result = VisitSchema.safeParse({
      trips: [{ start: '2020-01' }, { start: '2020-01', end: '2020-02' }, { start: '2020-01' }],
      placesToGo: ['The Narrows', 'Kolob', 'The Narrows'],
      photos: [photo, { ...photo, alt: 'B' }],
    });
    expect(issuesOf(result)).toEqual([
      'trips.2: This trip is listed twice. Remove one of them.',
      'placesToGo.2: This place is listed twice. Remove one of them.',
      'photos.1.src: This photo is listed twice. Remove one of them.',
    ]);
  });
});

describe('createVisitsSchema', () => {
  it('gives the park id and the field of a bad visit', () => {
    const result = VisitsSchema.safeParse({
      zion: { trips: [{ start: '2023-05-15', end: '2023-05-01' }] },
    });
    expect(issuePaths(result)).toEqual(['zion.trips.0.end']);
  });

  it('wants each owner photo in the folder of its park', () => {
    const result = VisitsSchema.safeParse({
      zion: { ...VISIT, photos: [{ src: '/photos/arches/arch.jpg', alt: 'An arch' }] },
    });
    expect(issuesOf(result)).toEqual([
      'zion.photos.0.src: Put the photo in the folder of this park: web/public/photos/zion/. Then use a path that starts with /photos/zion/.',
    ]);
  });

  it('accepts trips up to today, and a month-only date in the current month', () => {
    const visits = {
      zion: {
        trips: [
          { start: '2026-10-20', end: TODAY },
          { start: '2026-10', end: '2026-10' },
        ],
      },
    };
    expect(VisitsSchema.safeParse(visits).success).toBe(true);
  });

  it('rejects a trip date after today, and says the date of today', () => {
    const result = VisitsSchema.safeParse({
      zion: { trips: [{ start: '2026-10-22', end: '2026-10-24' }, { start: '2026-11' }] },
    });
    expect(issuesOf(result)).toEqual([
      'zion.trips.0.end: This date is in the future. Use a date on or before today (2026-10-23).',
      'zion.trips.1.start: This date is in the future. Use a date on or before today (2026-10-23).',
    ]);
    expect(
      createVisitsSchema('2026-11-01').safeParse({ zion: { trips: [{ start: '2026-11' }] } })
        .success,
    ).toBe(true);
  });

  it('asks for an object of visits', () => {
    expect(issuesOf(VisitsSchema.safeParse([]))).toEqual([
      ': Write the visits as an object with one entry for each park id, for example { "zion": { } }.',
    ]);
  });
});
