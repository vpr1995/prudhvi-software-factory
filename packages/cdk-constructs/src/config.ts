/**
 * Reads the `PATH` of this process. CDK runs local bundling with this `PATH` unless the
 * bundling environment sets its own. An empty value counts as unset.
 *
 * @param source - The environment variables. Defaults to `process.env`.
 * @returns The `PATH`, or `undefined` when it is not set.
 */
export function inheritedPath(
  source: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  const path = source['PATH'];
  return path === '' ? undefined : path;
}
