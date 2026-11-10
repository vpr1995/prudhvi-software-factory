import { describe, expect, it } from 'vitest';

import {
  filterByOrigin,
  parseGithubRepository,
  parseMediumRss,
  refreshFeeds,
} from '../../scripts/fetch-feeds.ts';
import { FeedsSchema } from '../../src/contracts/feeds.ts';
import type { Feeds } from '../../src/contracts/feeds.ts';

const MEDIUM_URL = 'https://medium.com/feed/@vprprudhvi';
const REPO_URL = 'https://api.github.com/repos/vpr1995/rbac-engine';
const MOVED_URL = 'https://api.github.com/repos/vpr1995/moved';

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Stories by Prudhvi on Medium</title>
    <item>
      <title><![CDATA[Newer post]]></title>
      <link>https://medium.com/@vprprudhvi/newer-post-abc123</link>
      <pubDate>Mon, 02 Mar 2026 09:00:00 GMT</pubDate>
      <description><![CDATA[<p>Summary text</p>]]></description>
      <content:encoded><![CDATA[<p>Full article BODY-SECRET</p>]]></content:encoded>
    </item>
    <item>
      <title>Older post</title>
      <link>https://medium.com/@vprprudhvi/older-post-def456</link>
      <pubDate>Sat, 01 Feb 2026 09:00:00 GMT</pubDate>
      <content:encoded><p><link>https://evil.example/x</link></p></content:encoded>
    </item>
  </channel>
</rss>`;

// The GitHub API uses snake case keys, so the fixtures are JSON text.
const REPO_TEXT =
  '{"full_name": "vpr1995/rbac-engine", "html_url": "https://github.com/vpr1995/rbac-engine", "description": "RBAC engine", "stargazers_count": 12, "private": false}';

const CONTENT = {
  medium: { handle: '@vprprudhvi', max: 6 },
  pinnedRepos: [{ fullName: 'vpr1995/rbac-engine' }],
};

const SNAPSHOT: Feeds = {
  medium: {
    fetchedAt: '2026-01-01T00:00:00.000Z',
    items: [
      {
        title: 'Newer post',
        url: 'https://medium.com/@vprprudhvi/newer-post-abc123',
        publishedAt: '2026-03-02T09:00:00.000Z',
      },
      {
        title: 'Older post',
        url: 'https://medium.com/@vprprudhvi/older-post-def456',
        publishedAt: '2026-02-01T09:00:00.000Z',
      },
    ],
  },
  github: {
    fetchedAt: '2026-01-01T00:00:00.000Z',
    repos: [
      {
        fullName: 'vpr1995/rbac-engine',
        url: 'https://github.com/vpr1995/rbac-engine',
        description: 'RBAC engine',
      },
    ],
  },
};

const NOW = new Date('2026-11-09T06:00:00.000Z');

/**
 * Parses a JSON text that holds an API response.
 *
 * @param text - The JSON text.
 * @returns The parsed value.
 */
function parseJson(text: string): unknown {
  const value: unknown = JSON.parse(text);
  return value;
}

/**
 * Builds a fake `fetch` that answers from a table of URLs. An unknown URL fails the test.
 *
 * @param routes - The response body for each URL, as text.
 * @returns A fetch function that records the URLs it was called with.
 */
function fakeFetch(routes: Record<string, string>): {
  fetchFn: (url: string) => Promise<Response>;
  calls: string[];
} {
  const calls: string[] = [];
  const fetchFunction = (url: string): Promise<Response> => {
    calls.push(url);
    const body = routes[url];
    if (body === undefined) {
      return Promise.reject(new Error(`Unexpected URL in a test: ${url}`));
    }
    return Promise.resolve(new Response(body, { status: 200 }));
  };
  return { fetchFn: fetchFunction, calls };
}

const ROUTES = {
  [MEDIUM_URL]: RSS,
  [REPO_URL]: REPO_TEXT,
};

describe('parseMediumRss (R-7)', () => {
  it('keeps only the title, the link and the date of each item', () => {
    const items = parseMediumRss(RSS);
    expect(items).toEqual([
      {
        title: 'Newer post',
        link: 'https://medium.com/@vprprudhvi/newer-post-abc123',
        pubDate: 'Mon, 02 Mar 2026 09:00:00 GMT',
      },
      {
        title: 'Older post',
        link: 'https://medium.com/@vprprudhvi/older-post-def456',
        pubDate: 'Sat, 01 Feb 2026 09:00:00 GMT',
      },
    ]);
  });

  it('never reads the article body', () => {
    const serialized = JSON.stringify(parseMediumRss(RSS));
    expect(serialized).not.toContain('BODY-SECRET');
    expect(serialized).not.toContain('Summary text');
    expect(serialized).not.toContain('evil.example');
  });

  it('returns no items for a feed without items', () => {
    expect(parseMediumRss('<rss><channel><title>Empty</title></channel></rss>')).toEqual([]);
  });

  it('throws when an item has no link', () => {
    const broken = RSS.replace('<link>https://medium.com/@vprprudhvi/older-post-def456</link>', '');
    expect(() => parseMediumRss(broken)).toThrow(/link/u);
  });
});

describe('parseGithubRepository (R-7)', () => {
  it('keeps the name, the URL and the description, and ignores the other fields', () => {
    expect(parseGithubRepository(parseJson(REPO_TEXT))).toEqual({
      fullName: 'vpr1995/rbac-engine',
      url: 'https://github.com/vpr1995/rbac-engine',
      description: 'RBAC engine',
    });
  });

  it('throws when the response does not match the contract', () => {
    expect(() => parseGithubRepository(parseJson('{"full_name": "vpr1995/rbac-engine"}'))).toThrow(
      /html_url/u,
    );
  });
});

describe('filterByOrigin (R-8)', () => {
  it('drops the items that are not on the allowed origin and reports them', () => {
    const items = [
      { title: 'Good', url: 'https://medium.com/@vprprudhvi/good' },
      { title: 'Mirror copy', url: 'https://example.net/mirror/copy' },
    ];
    const result = filterByOrigin(items, 'https://medium.com/', (item) => item.title);
    expect(result.kept).toEqual([items[0]]);
    expect(result.dropped).toEqual([{ title: 'Mirror copy', origin: 'https://example.net' }]);
  });
});

describe('refreshFeeds (R-7, R-8, R-9)', () => {
  it('fetches both feeds and returns the items with only the kept fields', async () => {
    const { fetchFn, calls } = fakeFetch(ROUTES);
    const result = await refreshFeeds({ fetchFn, content: CONTENT, snapshot: SNAPSHOT, now: NOW });

    expect(calls.toSorted()).toEqual([MEDIUM_URL, REPO_URL].toSorted());
    expect(result.snapshot.medium.items).toEqual([
      {
        title: 'Newer post',
        url: 'https://medium.com/@vprprudhvi/newer-post-abc123',
        publishedAt: '2026-03-02T09:00:00.000Z',
      },
      {
        title: 'Older post',
        url: 'https://medium.com/@vprprudhvi/older-post-def456',
        publishedAt: '2026-02-01T09:00:00.000Z',
      },
    ]);
    expect(result.snapshot.github.repos).toEqual([
      {
        fullName: 'vpr1995/rbac-engine',
        url: 'https://github.com/vpr1995/rbac-engine',
        description: 'RBAC engine',
      },
    ]);
    expect(FeedsSchema.safeParse(result.snapshot).success).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('keeps only the newest items up to content.medium.max', async () => {
    const { fetchFn } = fakeFetch(ROUTES);
    const result = await refreshFeeds({
      fetchFn,
      content: { ...CONTENT, medium: { handle: '@vprprudhvi', max: 1 } },
      snapshot: SNAPSHOT,
      now: NOW,
    });
    expect(result.snapshot.medium.items.map((item) => item.title)).toEqual(['Newer post']);
  });

  it('throws when a GitHub response does not match the contract', async () => {
    const { fetchFn } = fakeFetch({
      [MEDIUM_URL]: RSS,
      [REPO_URL]: '{"full_name": "vpr1995/rbac-engine"}',
    });
    await expect(
      refreshFeeds({ fetchFn, content: CONTENT, snapshot: SNAPSHOT, now: NOW }),
    ).rejects.toThrow(/html_url/u);
  });

  it('throws when a fetch fails', async () => {
    const fetchFunction = (): Promise<Response> =>
      Promise.resolve(new Response('Server error', { status: 500 }));
    await expect(
      refreshFeeds({ fetchFn: fetchFunction, content: CONTENT, snapshot: SNAPSHOT, now: NOW }),
    ).rejects.toThrow(/500/u);
  });

  it('drops an off-origin Medium item, keeps the others and warns with its title and origin', async () => {
    const withMirror = RSS.replace(
      '<item>\n      <title>Older post',
      `<item>
      <title>Mirror copy</title>
      <link>https://example.net/mirror/copy</link>
      <pubDate>Sun, 01 Mar 2026 09:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Older post`,
    );
    const { fetchFn } = fakeFetch({ ...ROUTES, [MEDIUM_URL]: withMirror });
    const result = await refreshFeeds({ fetchFn, content: CONTENT, snapshot: SNAPSHOT, now: NOW });

    expect(result.snapshot.medium.items.map((item) => item.title)).toEqual([
      'Newer post',
      'Older post',
    ]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('Mirror copy');
    expect(result.warnings[0]).toContain('https://example.net');
  });

  it('drops an off-origin GitHub repo and warns with its name and origin', async () => {
    const content = {
      ...CONTENT,
      pinnedRepos: [{ fullName: 'vpr1995/rbac-engine' }, { fullName: 'vpr1995/moved' }],
    };
    const { fetchFn } = fakeFetch({
      ...ROUTES,
      [MOVED_URL]:
        '{"full_name": "vpr1995/moved", "html_url": "https://gitlab.com/vpr1995/moved", "description": null}',
    });
    const result = await refreshFeeds({ fetchFn, content, snapshot: SNAPSHOT, now: NOW });

    expect(result.snapshot.github.repos.map((repository) => repository.fullName)).toEqual([
      'vpr1995/rbac-engine',
    ]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('vpr1995/moved');
    expect(result.warnings[0]).toContain('https://gitlab.com');
  });

  it('throws when every Medium item is dropped, instead of writing an empty list', async () => {
    const allOff = RSS.replaceAll('https://medium.com/', 'https://example.net/');
    const { fetchFn } = fakeFetch({ ...ROUTES, [MEDIUM_URL]: allOff });
    await expect(
      refreshFeeds({ fetchFn, content: CONTENT, snapshot: SNAPSHOT, now: NOW }),
    ).rejects.toThrow(/no items/u);
  });

  it('writes a new fetchedAt for a feed whose items changed and keeps the other feed', async () => {
    const changed = RSS.replace('Newer post', 'Brand new post');
    const { fetchFn } = fakeFetch({ ...ROUTES, [MEDIUM_URL]: changed });
    const result = await refreshFeeds({ fetchFn, content: CONTENT, snapshot: SNAPSHOT, now: NOW });

    expect(result.snapshot.medium.fetchedAt).toBe(NOW.toISOString());
    expect(result.snapshot.medium.items[0]?.title).toBe('Brand new post');
    expect(result.snapshot.github).toEqual(SNAPSHOT.github);
  });

  it('leaves the snapshot byte-identical when the items did not change', async () => {
    const { fetchFn } = fakeFetch(ROUTES);
    const later = new Date('2026-11-16T06:00:00.000Z');
    const result = await refreshFeeds({
      fetchFn,
      content: CONTENT,
      snapshot: SNAPSHOT,
      now: later,
    });

    expect(JSON.stringify(result.snapshot)).toBe(JSON.stringify(SNAPSHOT));
    expect(result.snapshot.medium.fetchedAt).toBe('2026-01-01T00:00:00.000Z');
  });
});
