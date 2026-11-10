// The Zod contract of `content/portfolio.json`. Each object is strict: a field that the contract
// does not name fails the build (R-4). The error messages say how to fix the value.
import { z } from 'zod';

const MAX_SHORT = 200;
const MAX_LONG = 400;
const MAX_BULLETS = 6;
const MAX_MEDIUM_ITEMS = 10;
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/u;
const YEAR_PATTERN = /^\d{4}$/u;
const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/u;
const PHONE_PATH = ['contact', 'phone'] as const;

/**
 * Phone-number shapes, each a simple regex. The first holds 10 digits in 3-3-4 groups, with optional
 * spaces, dots, dashes or brackets between the groups. The second adds a country code of 1 to 3
 * digits, with an optional `+`, before those 10 digits. A year range, a date, a percentage or a
 * figure does not match either one.
 */
const PHONE_NUMBER_ONLY = /(?<!\d)(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/u;
const PHONE_NUMBER_WITH_CODE =
  /(?<!\d)\+?\d{1,3}[\s.-]?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/u;
const PHONE_SHAPES: readonly RegExp[] = [PHONE_NUMBER_ONLY, PHONE_NUMBER_WITH_CODE];

/**
 * Tells whether a text holds a phone-number shape.
 *
 * @param value - The text.
 * @returns True when the text has a phone-number shape.
 */
export function hasPhoneShape(value: string): boolean {
  return PHONE_SHAPES.some((shape) => shape.test(value));
}

const quoteAll = (names: readonly PropertyKey[]): string =>
  names.map((name) => `"${String(name)}"`).join(', ');

/**
 * An object that accepts only the given fields. The message of an unknown field names the field
 * and lists the allowed fields.
 *
 * @param shape - The fields.
 * @param name - What the object is, for the message when the value is not an object.
 * @returns The strict object schema.
 */
function strictObject<Shape extends z.core.$ZodLooseShape>(
  shape: Shape,
  name: string,
): z.ZodObject<Shape, z.core.$strict> {
  const allowed = quoteAll(Object.keys(shape));
  return z.strictObject(shape, {
    error: (issue) =>
      issue.code === 'unrecognized_keys'
        ? `Remove or rename the unknown field ${quoteAll(issue.keys)}. The allowed fields are ${allowed}.`
        : `Write ${name} as an object in curly braces { }.`,
  });
}

/**
 * A text that is not empty and has at most `max` characters.
 *
 * @param max - The largest number of characters.
 * @returns The string schema.
 */
function text(max: number = MAX_SHORT): z.ZodString {
  return z
    .string({ error: 'Write the text in double quotes.' })
    .trim()
    .min(1, 'Write some text, or remove the field.')
    .max(max, `Use at most ${String(max)} characters.`);
}

/**
 * An `https` URL whose host is `host` or a sub-domain of it.
 *
 * @param host - The allowed domain, for example `github.com`.
 * @returns The string schema.
 */
function httpsUrlOn(host: string): z.ZodString {
  return text(MAX_SHORT).refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === 'https:' && (url.hostname === host || url.hostname.endsWith(`.${host}`))
      );
    } catch {
      return false;
    }
  }, `Use an https link on ${host}.`);
}

const httpsUrl = text(MAX_SHORT).refine((value) => {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}, 'Use an https link.');

const MonthSchema = z
  .string({ error: 'Write the month in double quotes, for example "2021-11".' })
  .regex(MONTH_PATTERN, 'Use the form YYYY-MM, for example "2021-11".');

const siteSchema = strictObject(
  {
    title: text(),
    description: text(),
    url: httpsUrl,
    ogImage: z
      .string()
      .startsWith('/', 'Start the image path with a slash, for example "/og.png".')
      .optional(),
  },
  'the site settings',
);

const profileSchema = strictObject(
  {
    name: text(),
    headline: text(),
    summary: text(MAX_LONG),
    location: strictObject(
      { primary: text(), also: z.array(text(), { error: 'Write the places as a list in [ ].' }) },
      'the location',
    ),
  },
  'the profile',
);

const contactSchema = strictObject(
  {
    email: z.email('Use a valid email address.'),
    linkedin: httpsUrlOn('linkedin.com'),
    github: httpsUrlOn('github.com'),
    medium: httpsUrlOn('medium.com'),
    phone: strictObject({ display: text(), href: text() }, 'the phone').optional(),
  },
  'the contact details',
);

const experienceSchema = strictObject(
  {
    company: text(),
    role: text(),
    location: text(),
    start: MonthSchema,
    end: MonthSchema.nullable(),
    bullets: z
      .array(text(MAX_LONG), { error: 'Write the bullets as a list in [ ].' })
      .min(1, 'Write at least one bullet.')
      .max(MAX_BULLETS, `Use at most ${String(MAX_BULLETS)} bullets.`),
    metrics: z.array(strictObject({ label: text(), value: text() }, 'a metric')).optional(),
  },
  'an experience entry',
);

const awardSchema = strictObject(
  {
    title: text(),
    year: z
      .string({ error: 'Write the year in double quotes, for example "2025".' })
      .regex(YEAR_PATTERN, 'Use a four-digit year, for example "2025".'),
    issuer: text().optional(),
    source: httpsUrl,
  },
  'an award',
);

const pinnedRepositorySchema = strictObject(
  {
    fullName: z
      .string({ error: 'Write the repo name in double quotes, for example "owner/name".' })
      .regex(REPO_PATTERN, 'Use the form owner/name.'),
    blurb: text().optional(),
  },
  'a pinned repo',
);

const mediumSchema = strictObject(
  {
    handle: text(),
    max: z
      .number({ error: 'Write a whole number, without quotes.' })
      .int('Write a whole number.')
      .min(1, 'Use at least 1.')
      .max(MAX_MEDIUM_ITEMS, `Use at most ${String(MAX_MEDIUM_ITEMS)}.`),
  },
  'the Medium settings',
);

/**
 * Walks a parsed value and reports each string with a phone-number shape, except the one at
 * `contact.phone`.
 *
 * @param value - The value to walk.
 * @param path - The path of the value so far.
 * @param report - Called with the path of each match.
 */
function findPhoneShapes(
  value: unknown,
  path: readonly (string | number)[],
  report: (path: readonly (string | number)[]) => void,
): void {
  if (path.length === PHONE_PATH.length && PHONE_PATH.every((key, index) => path[index] === key)) {
    return;
  }
  if (typeof value === 'string') {
    if (hasPhoneShape(value)) {
      report(path);
    }
  } else if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      findPhoneShapes(item, [...path, index], report);
    }
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      findPhoneShapes(item, [...path, key], report);
    }
  }
}

export const ContentSchema = strictObject(
  {
    site: siteSchema,
    profile: profileSchema,
    contact: contactSchema,
    experience: z
      .array(experienceSchema, { error: 'Write the experience as a list in [ ].' })
      .min(1, 'Add at least one experience entry.'),
    awards: z.array(awardSchema, { error: 'Write the awards as a list in [ ].' }),
    pinnedRepos: z.array(pinnedRepositorySchema, {
      error: 'Write the pinned repos as a list in [ ].',
    }),
    medium: mediumSchema,
  },
  'the content',
).superRefine((content, context) => {
  findPhoneShapes(content, [], (path) => {
    context.addIssue({
      code: 'custom',
      path: [...path],
      message:
        'This text looks like a phone number. Put the number only in contact.phone, which the page shows behind a click.',
    });
  });
});

/**
 * The parsed content file. The type of a valid `content/portfolio.json`.
 */
export type Content = z.infer<typeof ContentSchema>;
