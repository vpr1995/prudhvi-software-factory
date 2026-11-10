import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { ContentSchema, hasPhoneShape } from '../../src/contracts/content.ts';

const sample: unknown = JSON.parse(
  readFileSync(new URL('../../content/portfolio.json', import.meta.url), 'utf8'),
);

type Container = Record<PropertyKey, unknown>;
type Path = readonly (string | number)[];

/**
 * Checks that a value is an object or a list, so that a key can be read from it.
 *
 * @param value - The value to check.
 * @param key - The key that leads to the value, for the message.
 * @returns The value as a container.
 */
function asContainer(value: unknown, key: string | number): Container {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`No object or list at ${String(key)}`);
  }
  return value as Container;
}

/**
 * Finds the object or list that holds the last key of a path.
 *
 * @param copy - The root of the copy.
 * @param path - The path of a value.
 * @returns The container of the last key.
 */
function parentOf(copy: Container, path: Path): Container {
  let node = copy;
  for (const key of path.slice(0, -1)) {
    node = asContainer(node[key], key);
  }
  return node;
}

/**
 * Sets the value at a path of the copy.
 *
 * @param copy - The root of the copy.
 * @param path - The path of the value.
 * @param value - The new value.
 */
function setPath(copy: Container, path: Path, value: unknown): void {
  const last = path.at(-1);
  if (last === undefined) {
    throw new TypeError('The path is empty');
  }
  parentOf(copy, path)[last] = value;
}

/**
 * Deletes the value at a path of the copy.
 *
 * @param copy - The root of the copy.
 * @param path - The path of the value.
 */
function deletePath(copy: Container, path: Path): void {
  const last = path.at(-1);
  if (last === undefined) {
    throw new TypeError('The path is empty');
  }
  Reflect.deleteProperty(parentOf(copy, path), last);
}

/**
 * Copies the sample content and applies a change.
 *
 * @param change - Changes the copy.
 * @returns The changed copy.
 */
function withChange(change: (copy: Container) => void): unknown {
  const copy = structuredClone(sample) as Container;
  change(copy);
  return copy;
}

describe('content contract (R-3)', () => {
  it('accepts the sample content file', () => {
    expect(ContentSchema.safeParse(sample).success).toBe(true);
  });

  it('names the JSON path of a wrong value', () => {
    const result = ContentSchema.safeParse(
      withChange((c) => {
        setPath(c, ['experience', 0, 'start'], 'Jan 2020');
      }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['experience', 0, 'start']);
  });
});

describe('content contract (R-4)', () => {
  it('rejects a field that the contract does not name, and names the field', () => {
    const result = ContentSchema.safeParse(
      withChange((c) => {
        setPath(c, ['profile', 'salary'], '1');
      }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain('"salary"');
    expect(result.error?.issues[0]?.message).toContain('allowed fields');
  });

  it('rejects an award with no source', () => {
    const result = ContentSchema.safeParse(
      withChange((c) => {
        deletePath(c, ['awards', 0, 'source']);
      }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['awards', 0, 'source']);
  });

  it('rejects a link that is not https or not on the named site', () => {
    expect(
      ContentSchema.safeParse(
        withChange((c) => {
          setPath(c, ['contact', 'github'], 'http://github.com/x');
        }),
      ).success,
    ).toBe(false);
    expect(
      ContentSchema.safeParse(
        withChange((c) => {
          setPath(c, ['contact', 'medium'], 'https://example.com/@x');
        }),
      ).success,
    ).toBe(false);
  });

  it('rejects a summary over 400 characters', () => {
    expect(
      ContentSchema.safeParse(
        withChange((c) => {
          setPath(c, ['profile', 'summary'], 'x'.repeat(401));
        }),
      ).success,
    ).toBe(false);
  });

  it('accepts a phone number only in contact.phone', () => {
    const phone = { display: '+1 (360) 685-3897', href: 'tel:+13606853897' };
    expect(
      ContentSchema.safeParse(
        withChange((c) => {
          setPath(c, ['contact', 'phone'], phone);
        }),
      ).success,
    ).toBe(true);
  });

  it('rejects a phone number in a bullet, and names the path', () => {
    const result = ContentSchema.safeParse(
      withChange((c) => {
        setPath(c, ['experience', 0, 'bullets'], ['Call 360-685-3897']);
      }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['experience', 0, 'bullets', 0]);
    expect(result.error?.issues[0]?.message).toContain('contact.phone');
  });
});

describe('content contract: phone href, repo names and handle', () => {
  const parseWith = (path: Path, value: unknown): ReturnType<typeof ContentSchema.safeParse> =>
    ContentSchema.safeParse(
      withChange((c) => {
        setPath(c, path, value);
      }),
    );

  it.each(['javascript:alert(1)', 'https://x'])('rejects the phone href %s', (href) => {
    const result = parseWith(['contact', 'phone'], { display: '+1 (555) 010-0100', href });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['contact', 'phone', 'href']);
    expect(result.error?.issues[0]?.message).toContain('tel:');
  });

  it('accepts the sample phone href', () => {
    expect(
      parseWith(['contact', 'phone'], { display: '+1 (555) 010-0100', href: 'tel:+15550100100' })
        .success,
    ).toBe(true);
  });

  it.each(['../..', 'a/..', './x', '../x', '..'])('rejects the repo name %s', (fullName) => {
    expect(parseWith(['pinnedRepos', 0, 'fullName'], fullName).success).toBe(false);
  });

  it.each(['vpr1995/rbac-engine', 'a.b/c_d', 'a/b..c', 'o/.github'])(
    'accepts the repo name %s',
    (fullName) => {
      expect(parseWith(['pinnedRepos', 0, 'fullName'], fullName).success).toBe(true);
    },
  );

  it.each(['../x', 'a/b', 'a b', '@a?b=c', ''])('rejects the Medium handle %j', (handle) => {
    expect(parseWith(['medium', 'handle'], handle).success).toBe(false);
  });

  it('accepts the Medium handle with and without the at sign', () => {
    expect(parseWith(['medium', 'handle'], '@vprprudhvi').success).toBe(true);
    expect(parseWith(['medium', 'handle'], 'vpr.prudhvi_1').success).toBe(true);
  });
});

describe('phone-number shape table', () => {
  it.each([
    '2019 - 2023',
    '2021-11',
    '$250K ARR',
    '4M+ users',
    '500M+ events a day',
    '99.99% uptime',
    '1M+ households',
    '12 epics over 2 years',
    'https://github.com/vpr1995/rbac-engine',
  ])('passes %s', (value) => {
    expect(hasPhoneShape(value)).toBe(false);
  });

  it.each(['+1 (360) 685-3897', '360-685-3897', '360.685.3897', '3606853897'])(
    'fails %s',
    (value) => {
      expect(hasPhoneShape(value)).toBe(true);
    },
  );
});

describe('content contract: skills', () => {
  it('accepts the skill groups of the sample content', () => {
    const result = ContentSchema.safeParse(sample);
    expect(result.success).toBe(true);
    expect(result.data?.skills.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects a missing skills block, and names the path', () => {
    const result = ContentSchema.safeParse(
      withChange((c) => {
        deletePath(c, ['skills']);
      }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['skills']);
  });

  it('rejects an empty list of groups and more than 8 groups', () => {
    const empty = ContentSchema.safeParse(
      withChange((c) => {
        setPath(c, ['skills'], []);
      }),
    );
    expect(empty.error?.issues[0]?.message).toContain('Add at least one skill group');

    const tooMany = ContentSchema.safeParse(
      withChange((c) => {
        setPath(
          c,
          ['skills'],
          Array.from({ length: 9 }, (_, index) => ({
            category: `Group ${String(index)}`,
            items: ['A'],
          })),
        );
      }),
    );
    expect(tooMany.error?.issues[0]?.message).toContain('Use at most 8 skill groups');
  });

  it('rejects a group with no items, an empty item, and more than 24 items', () => {
    const noItems = ContentSchema.safeParse(
      withChange((c) => {
        setPath(c, ['skills', 0, 'items'], []);
      }),
    );
    expect(noItems.error?.issues[0]?.path).toEqual(['skills', 0, 'items']);
    expect(noItems.error?.issues[0]?.message).toContain('Add at least one skill');

    const emptyItem = ContentSchema.safeParse(
      withChange((c) => {
        setPath(c, ['skills', 0, 'items', 0], '   ');
      }),
    );
    expect(emptyItem.error?.issues[0]?.path).toEqual(['skills', 0, 'items', 0]);

    const tooMany = ContentSchema.safeParse(
      withChange((c) => {
        setPath(
          c,
          ['skills', 0, 'items'],
          Array.from({ length: 25 }, (_, index) => `Skill ${String(index)}`),
        );
      }),
    );
    expect(tooMany.error?.issues[0]?.message).toContain('Use at most 24 skills');
  });

  it('rejects an empty category and an unknown field, and names the field', () => {
    const emptyCategory = ContentSchema.safeParse(
      withChange((c) => {
        setPath(c, ['skills', 0, 'category'], '');
      }),
    );
    expect(emptyCategory.error?.issues[0]?.path).toEqual(['skills', 0, 'category']);

    const extra = ContentSchema.safeParse(
      withChange((c) => {
        setPath(c, ['skills', 0, 'level'], 'expert');
      }),
    );
    expect(extra.success).toBe(false);
    expect(extra.error?.issues[0]?.message).toContain('"level"');
  });

  it('rejects two groups with the same category, and names the path and the rule', () => {
    const result = ContentSchema.safeParse(
      withChange((c) => {
        const skills = c['skills'] as { category: string; items: string[] }[];
        setPath(c, ['skills'], [skills[0], { ...skills[0] }]);
      }),
    );
    expect(result.success).toBe(false);
    const issue = result.error?.issues.find((item) => item.message.includes('twice'));
    expect(issue?.path).toEqual(['skills', 1, 'category']);
    expect(issue?.message).toContain('Use each category name once');
  });
});

describe('content contract: certifications', () => {
  it('accepts the certifications of the sample content', () => {
    const result = ContentSchema.safeParse(sample);
    expect(result.success).toBe(true);
    expect(result.data?.certifications.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects a missing certifications block, an empty list and more than 12 entries', () => {
    const missing = ContentSchema.safeParse(
      withChange((c) => {
        deletePath(c, ['certifications']);
      }),
    );
    expect(missing.error?.issues[0]?.path).toEqual(['certifications']);

    const empty = ContentSchema.safeParse(
      withChange((c) => {
        setPath(c, ['certifications'], []);
      }),
    );
    expect(empty.error?.issues[0]?.message).toContain('Add at least one certification');

    const tooMany = ContentSchema.safeParse(
      withChange((c) => {
        setPath(
          c,
          ['certifications'],
          Array.from({ length: 13 }, (_, index) => ({
            name: `Cert ${String(index)}`,
            issuer: 'Issuer',
            issued: '2024-01',
          })),
        );
      }),
    );
    expect(tooMany.error?.issues[0]?.message).toContain('Use at most 12 certifications');
  });

  it('accepts an entry with only the required fields', () => {
    const result = ContentSchema.safeParse(
      withChange((c) => {
        setPath(c, ['certifications'], [{ name: 'A', issuer: 'B', issued: '2024-01' }]);
      }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects a bad month, and names the path', () => {
    const result = ContentSchema.safeParse(
      withChange((c) => {
        setPath(c, ['certifications', 0, 'issued'], 'Sep 2024');
      }),
    );
    expect(result.error?.issues[0]?.path).toEqual(['certifications', 0, 'issued']);
    expect(result.error?.issues[0]?.message).toContain('Use the form YYYY-MM');
  });

  it('rejects a credential link that is not https, and names the path', () => {
    const result = ContentSchema.safeParse(
      withChange((c) => {
        setPath(c, ['certifications', 0, 'credentialUrl'], 'http://example.com/c');
      }),
    );
    expect(result.error?.issues[0]?.path).toEqual(['certifications', 0, 'credentialUrl']);
    expect(result.error?.issues[0]?.message).toContain('Use an https link');
  });

  it('rejects an unknown field and an empty name', () => {
    const extra = ContentSchema.safeParse(
      withChange((c) => {
        setPath(c, ['certifications', 0, 'score'], '900');
      }),
    );
    expect(extra.error?.issues[0]?.message).toContain('"score"');

    const empty = ContentSchema.safeParse(
      withChange((c) => {
        setPath(c, ['certifications', 0, 'name'], '');
      }),
    );
    expect(empty.error?.issues[0]?.path).toEqual(['certifications', 0, 'name']);
  });

  it('rejects an expiry before the issue month, and names the path and the rule', () => {
    const result = ContentSchema.safeParse(
      withChange((c) => {
        setPath(c, ['certifications', 0, 'issued'], '2024-09');
        setPath(c, ['certifications', 0, 'expires'], '2024-08');
      }),
    );
    expect(result.success).toBe(false);
    const issue = result.error?.issues.find((item) => item.message.includes('before'));
    expect(issue?.path).toEqual(['certifications', 0, 'expires']);
    expect(issue?.message).toContain('Use an expiry month that is not before the issue month');
  });

  it('accepts an expiry in the same month as the issue month', () => {
    const result = ContentSchema.safeParse(
      withChange((c) => {
        setPath(c, ['certifications', 0, 'issued'], '2024-09');
        setPath(c, ['certifications', 0, 'expires'], '2024-09');
      }),
    );
    expect(result.success).toBe(true);
  });
});
