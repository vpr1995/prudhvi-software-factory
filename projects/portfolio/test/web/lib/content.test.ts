import { describe, expect, it } from 'vitest';

import portfolioJson from '../../../content/portfolio.json';
import { ContentSchema } from '../../../src/contracts/content.ts';
import { formatContentIssues, parseContent } from '../../../web/lib/content.ts';

type Json = Record<string, unknown>;

/**
 * A deep copy of the real content file, so that a test can change one value.
 *
 * @returns A copy of the content file as plain JSON.
 */
function copyContent(): Json {
  return structuredClone(portfolioJson);
}

/**
 * Runs the loader on a value that it should reject, and returns the error message.
 *
 * @param value - The value to parse.
 * @returns The message of the error that the loader throws.
 */
function errorMessageOf(value: unknown): string {
  try {
    parseContent(value);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('parseContent accepted a value that it should reject');
}

describe('parseContent', () => {
  it('loads the valid content file', () => {
    const content = parseContent(portfolioJson);

    expect(content.profile.name).toBe('Sample Name');
    expect(content.experience[0]?.start).toBe('2020-01');
  });

  it('throws with the JSON path and the rule when a date has the wrong form', () => {
    const copy = copyContent();
    const experience = copy['experience'] as Json[];
    experience[0] = { ...experience[0], start: '2020/01' };

    const message = errorMessageOf(copy);

    expect(message).toContain('experience[0].start');
    expect(message).toContain('Use the form YYYY-MM');
  });

  it('throws and names the field when a field is not in the contract', () => {
    const copy = copyContent();
    (copy['site'] as Json)['favicon'] = '/favicon.ico';

    const message = errorMessageOf(copy);

    expect(message).toContain('site');
    expect(message).toContain('favicon');
  });

  it('throws and names the path of a phone number in a bullet', () => {
    const copy = copyContent();
    const experience = copy['experience'] as Json[];
    experience[0] = { ...experience[0], bullets: ['Call +1 (360) 685-3897 to book.'] };

    const message = errorMessageOf(copy);

    expect(message).toContain('experience[0].bullets[0]');
    expect(message).toContain('phone number');
  });

  it('accepts a phone number only in contact.phone', () => {
    const copy = copyContent();
    copy['contact'] = {
      ...(copy['contact'] as Json),
      phone: { display: '+1 (360) 685-3897', href: 'tel:+13606853897' },
    };

    expect(parseContent(copy).contact.phone?.display).toBe('+1 (360) 685-3897');
  });
});

describe('formatContentIssues', () => {
  it('writes one line for each issue, with the JSON path and the message', () => {
    const result = ContentSchema.safeParse({});
    if (result.success) {
      throw new Error('The empty object should fail the contract');
    }

    const lines = formatContentIssues(result.error.issues).split('\n');

    expect(lines.length).toBe(result.error.issues.length);
    expect(lines.every((line) => line.includes(': '))).toBe(true);
    expect(lines.some((line) => line.startsWith('site: '))).toBe(true);
  });

  it('writes the array index in brackets, not with a dot', () => {
    const copy = copyContent();
    const experience = copy['experience'] as Json[];
    experience[2] = { ...experience[0], start: 'soon' };

    const result = ContentSchema.safeParse(copy);
    if (result.success) {
      throw new Error('The copy should fail the contract');
    }

    expect(formatContentIssues(result.error.issues)).toContain('experience[2].start: ');
  });

  it('keeps a message on one line', () => {
    const issues = [
      { code: 'custom', path: ['profile', 'summary'], message: 'First line.\nSecond line.' },
    ] as const;

    expect(formatContentIssues(issues)).toBe('profile.summary: First line. Second line.');
  });
});
