// The config of the feed script. It is the only module of the script that reads the environment.

/**
 * The GitHub token. It is optional: without it, the GitHub API allows fewer requests. The value is
 * never printed.
 *
 * @param source - The environment variables. Defaults to the process environment.
 * @returns The token, or `undefined` when it is not set or empty.
 */
export function readGithubToken(
  source: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  const token = source['GITHUB_TOKEN'];
  return token === undefined || token.trim() === '' ? undefined : token;
}

// An optional at sign, then letters, digits, dots, hyphens and underscores. No slash, query or space.
const MEDIUM_HANDLE_PATTERN = /^@?[A-Za-z0-9._-]{1,64}$/;

/**
 * The Medium handle that replaces the handle of `content/portfolio.json` for one run. The weekly
 * workflow sets it from its manual input. The value goes into a URL path, so it must match a strict
 * pattern.
 *
 * @param source - The environment variables. Defaults to the process environment.
 * @returns The handle, or `undefined` when the variable is not set or blank.
 * @throws Error when the value is not a valid handle. The message does not repeat the value.
 */
export function readMediumHandle(
  source: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  const value = source['FEEDS_MEDIUM_HANDLE']?.trim();
  if (value === undefined || value === '') {
    return undefined;
  }
  if (!MEDIUM_HANDLE_PATTERN.test(value)) {
    throw new Error(
      'FEEDS_MEDIUM_HANDLE is not a valid Medium handle. Use letters, digits, dots, hyphens and underscores, with an optional leading @.',
    );
  }
  return value;
}
