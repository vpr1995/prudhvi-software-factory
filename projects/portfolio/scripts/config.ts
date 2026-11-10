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
