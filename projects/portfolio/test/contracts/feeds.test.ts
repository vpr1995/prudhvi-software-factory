import { describe, expect, it } from 'vitest';

import {
  FeedsSchema,
  GithubRepositoryResponseSchema,
  MediumRssItemSchema,
} from '../../src/contracts/feeds.ts';

const validFeeds = {
  medium: {
    fetchedAt: '2026-11-01T06:00:00.000Z',
    items: [
      {
        title: 'A post',
        url: 'https://medium.com/@vprprudhvi/a-post-abc123',
        publishedAt: '2026-10-30T09:00:00.000Z',
      },
    ],
  },
  github: {
    fetchedAt: '2026-11-01T06:00:00.000Z',
    repos: [
      {
        fullName: 'vpr1995/rbac-engine',
        url: 'https://github.com/vpr1995/rbac-engine',
        description: null,
      },
    ],
  },
};

/**
 * Parses a JSON text that holds an API response. The API uses snake case keys, so the fixtures
 * are text, not object literals.
 *
 * @param text - The JSON text.
 * @returns The parsed value.
 */
function parseJson(text: string): unknown {
  const value: unknown = JSON.parse(text);
  return value;
}

/**
 * Copies the valid snapshot so that one test can change one field.
 *
 * @returns A deep copy of the valid snapshot.
 */
function copyFeeds(): Record<string, unknown> {
  const copy: Record<string, unknown> = structuredClone(validFeeds);
  return copy;
}

describe('FeedsSchema', () => {
  it('accepts a valid snapshot', () => {
    expect(FeedsSchema.safeParse(validFeeds).success).toBe(true);
  });

  it('rejects a field that the contract does not name', () => {
    const copy = copyFeeds();
    copy['extra'] = true;
    expect(FeedsSchema.safeParse(copy).success).toBe(false);
  });

  it('rejects an unknown field inside a Medium item', () => {
    const copy = copyFeeds();
    const medium = copy['medium'] as { items: Record<string, unknown>[] };
    medium.items[0] = { ...medium.items[0], body: 'the article text' };
    expect(FeedsSchema.safeParse(copy).success).toBe(false);
  });

  it('rejects a Medium item whose URL is not on medium.com', () => {
    const copy = copyFeeds();
    const medium = copy['medium'] as { items: Record<string, unknown>[] };
    medium.items[0] = { ...medium.items[0], url: 'https://example.com/a-post' };
    expect(FeedsSchema.safeParse(copy).success).toBe(false);
  });

  it('rejects a GitHub repo whose URL is not on github.com', () => {
    const copy = copyFeeds();
    const github = copy['github'] as { repos: Record<string, unknown>[] };
    github.repos[0] = { ...github.repos[0], url: 'https://gitlab.com/vpr1995/rbac-engine' };
    expect(FeedsSchema.safeParse(copy).success).toBe(false);
  });

  it('rejects a fetchedAt that is not an ISO datetime', () => {
    const copy = copyFeeds();
    (copy['medium'] as Record<string, unknown>)['fetchedAt'] = 'yesterday';
    expect(FeedsSchema.safeParse(copy).success).toBe(false);
  });
});

describe('MediumRssItemSchema', () => {
  it('accepts an item with a title, a link and a date', () => {
    const parsed = MediumRssItemSchema.parse({
      title: 'A post',
      link: 'https://medium.com/@vprprudhvi/a-post-abc123',
      pubDate: 'Mon, 02 Mar 2026 09:00:00 GMT',
    });
    expect(parsed.link).toBe('https://medium.com/@vprprudhvi/a-post-abc123');
  });

  it('accepts a link on any https host, so one off-origin item does not reject the feed', () => {
    const result = MediumRssItemSchema.safeParse({
      title: 'Mirror',
      link: 'https://example.net/mirror',
      pubDate: 'Mon, 02 Mar 2026 09:00:00 GMT',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a link that is not https', () => {
    const result = MediumRssItemSchema.safeParse({
      title: 'Plain',
      link: 'http://medium.com/@vprprudhvi/plain',
      pubDate: 'Mon, 02 Mar 2026 09:00:00 GMT',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an item without a link', () => {
    const result = MediumRssItemSchema.safeParse({
      title: 'No link',
      pubDate: 'Mon, 02 Mar 2026 09:00:00 GMT',
    });
    expect(result.success).toBe(false);
  });
});

describe('GithubRepositoryResponseSchema', () => {
  it('ignores the extra GitHub fields and keeps the three it reads', () => {
    const parsed = GithubRepositoryResponseSchema.parse(
      parseJson(
        '{"full_name": "vpr1995/rbac-engine", "html_url": "https://github.com/vpr1995/rbac-engine", "description": "RBAC engine", "stargazers_count": 12, "private": false}',
      ),
    );
    expect(parsed).toEqual(
      parseJson(
        '{"full_name": "vpr1995/rbac-engine", "html_url": "https://github.com/vpr1995/rbac-engine", "description": "RBAC engine"}',
      ),
    );
  });

  it('accepts a null description', () => {
    const result = GithubRepositoryResponseSchema.safeParse(
      parseJson(
        '{"full_name": "vpr1995/rbac-engine", "html_url": "https://github.com/vpr1995/rbac-engine", "description": null}',
      ),
    );
    expect(result.success).toBe(true);
  });

  it('rejects a response without html_url', () => {
    const result = GithubRepositoryResponseSchema.safeParse(
      parseJson('{"full_name": "vpr1995/rbac-engine", "description": null}'),
    );
    expect(result.success).toBe(false);
  });
});
