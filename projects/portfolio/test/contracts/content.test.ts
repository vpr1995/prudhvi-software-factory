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
