// Build time only: Server Components import this module while `next build` renders the pages.
// The JSON file is bundled with the module, so no file is read at run time: the site is static.
import portfolioJson from '../../content/portfolio.json';
import { ContentSchema } from '../../src/contracts/content.ts';
import type { Content } from '../../src/contracts/content.ts';

/** The minimal shape of a Zod issue that the formatter reads. */
type ContentIssue = {
  readonly path: readonly PropertyKey[];
  readonly message: string;
};

/**
 * Writes the JSON path of an issue, for example `experience[0].start`.
 *
 * @param path - The path from the Zod issue.
 * @returns The path. The root of the file is `(root)`.
 */
function formatPath(path: readonly PropertyKey[]): string {
  if (path.length === 0) {
    return '(root)';
  }
  return path.reduce<string>((text, key) => {
    if (typeof key === 'number') {
      return `${text}[${String(key)}]`;
    }
    const name = String(key);
    return text === '' ? name : `${text}.${name}`;
  }, '');
}

/**
 * Turns the issues of a failed parse into text with one line for each issue. Each line holds the
 * JSON path, then the rule.
 *
 * @param issues - The issues of a Zod parse.
 * @returns One line for each issue, joined with a new line.
 */
export function formatContentIssues(issues: readonly ContentIssue[]): string {
  return issues
    .map((issue) => `${formatPath(issue.path)}: ${issue.message.replaceAll(/\s*\n\s*/gu, ' ')}`)
    .join('\n');
}

/**
 * Parses a value with the content contract.
 *
 * @param value - The parsed JSON of `content/portfolio.json`.
 * @returns The valid content.
 * @throws Error whose message names the file and gives one line for each issue.
 */
export function parseContent(value: unknown): Content {
  const result = ContentSchema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `Invalid content/portfolio.json. Fix each line below.\n${formatContentIssues(result.error.issues)}`,
    );
  }
  return result.data;
}

/** The validated content of the site. The build fails here when the file is not valid. */
export const content: Content = parseContent(portfolioJson);
