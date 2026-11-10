// The Zod contracts of `content/feeds.json` and of the two feed responses. The snapshot objects are
// strict: a field that the contract does not name fails. The responses ignore the fields they do
// not read, so a GitHub field that is added later does not break the refresh.
import { z } from 'zod';

const MEDIUM_ORIGIN = 'https://medium.com/';
const GITHUB_ORIGIN = 'https://github.com/';

// The field names of the GitHub API response. They are kept in snake case as the API sends them.
export const GITHUB_FIELD = { fullName: 'full_name', htmlUrl: 'html_url' } as const;

/**
 * A text with an `https` URL.
 *
 * @returns The string schema.
 */
function httpsUrl(): z.ZodString {
  return z.string().refine((value) => {
    try {
      return new URL(value).protocol === 'https:';
    } catch {
      return false;
    }
  }, 'Use an https link.');
}

/**
 * A snapshot Medium item. Its URL must be on medium.com.
 */
const MediumItemSchema = z.strictObject({
  title: z.string().min(1, 'Write the title of the article.'),
  url: z.string().startsWith(MEDIUM_ORIGIN, `Use a link that starts with ${MEDIUM_ORIGIN}.`),
  publishedAt: z.iso.datetime({
    message: 'Use an ISO date and time, for example 2026-03-02T09:00:00.000Z.',
  }),
});

/**
 * A snapshot GitHub repo. Its URL must be on github.com.
 */
const GithubRepositorySchema = z.strictObject({
  fullName: z.string().min(1, 'Write the repo name as owner/name.'),
  url: z.string().startsWith(GITHUB_ORIGIN, `Use a link that starts with ${GITHUB_ORIGIN}.`),
  description: z.string().nullable(),
});

/**
 * The Medium part of the snapshot.
 */
const MediumSnapshotSchema = z.strictObject({
  fetchedAt: z.iso.datetime({
    message: 'Use an ISO date and time, for example 2026-03-02T09:00:00.000Z.',
  }),
  items: z.array(MediumItemSchema),
});

/**
 * The GitHub part of the snapshot.
 */
const GithubSnapshotSchema = z.strictObject({
  fetchedAt: z.iso.datetime({
    message: 'Use an ISO date and time, for example 2026-03-02T09:00:00.000Z.',
  }),
  repos: z.array(GithubRepositorySchema),
});

/**
 * The parsed content of `content/feeds.json`.
 */
export const FeedsSchema = z.strictObject({
  medium: MediumSnapshotSchema,
  github: GithubSnapshotSchema,
});

/**
 * One item of the Medium RSS feed, with only the three fields that the refresh reads. The link may
 * be on any `https` host: the refresh drops the items that are off the Medium origin (R-8).
 */
export const MediumRssItemSchema = z.object({
  title: z.string(),
  link: httpsUrl(),
  pubDate: z.string(),
});

/**
 * The GitHub repo response, with the three fields that the refresh reads. Other fields are ignored.
 */
export const GithubRepositoryResponseSchema = z.object({
  [GITHUB_FIELD.fullName]: z.string(),
  [GITHUB_FIELD.htmlUrl]: httpsUrl(),
  description: z.string().nullable(),
});

/** A Medium item of the snapshot. */
export type MediumItem = z.infer<typeof MediumItemSchema>;
/** A GitHub repo of the snapshot. */
export type GithubRepository = z.infer<typeof GithubRepositorySchema>;
/** The parsed content of `content/feeds.json`. */
export type Feeds = z.infer<typeof FeedsSchema>;
/** One item of the Medium RSS feed. */
export type MediumRssItem = z.infer<typeof MediumRssItemSchema>;
/** The GitHub repo response. */
export type GithubRepositoryResponse = z.infer<typeof GithubRepositoryResponseSchema>;
