/**
 * Keys whose values the logger replaces with `[REDACTED]`, at any of the first four levels.
 * Write each key in camelCase. `buildRedactPaths` also covers the snake_case, kebab-case, lower
 * case and capitalized forms (`access_token`, `x-api-key`, `Set-Cookie`).
 */
export const REDACTED_KEYS = [
  'password',
  'passwd',
  'token',
  'accessToken',
  'refreshToken',
  'idToken',
  'sessionToken',
  'authToken',
  'secret',
  'clientSecret',
  'apiKey',
  'privateKey',
  'authorization',
  'proxyAuthorization',
  'cookie',
  'setCookie',
  'xApiKey',
  'xAuthToken',
  'xCsrfToken',
  'xAmzSecurityToken',
  'email',
  'phone',
  'ssn',
] as const;

/** The text that replaces a redacted value. */
export const REDACTED_TEXT = '[REDACTED]';

/** How many object levels below the root the redaction covers. */
const REDACTION_DEPTH = 3;

const SIMPLE_KEY = /^[A-Za-z_$][\w$]*$/;

/**
 * Lists the spellings of one key: as written, lower case, snake_case, kebab-case and Title-Kebab. HTTP headers use the kebab and lower forms, JSON bodies use the others.
 *
 * @param key - A key in camelCase.
 * @returns The distinct spellings.
 */
export function keyVariants(key: string): string[] {
  const words = key.replaceAll(/([a-z\d])([A-Z])/g, '$1 $2').split(' ');
  const lower = words.map((word) => word.toLowerCase());
  const capitalize = (word: string): string => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`;
  return [
    ...new Set([
      key,
      key.toLowerCase(),
      lower.join('_'),
      lower.join('-'),
      lower.map((word) => capitalize(word)).join('-'),
    ]),
  ];
}

/**
 * Writes one key as a path segment. A key that is not a plain identifier (`set-cookie`) needs the
 * bracket form, or pino throws when it builds the logger.
 *
 * @param prefix - The wildcard prefix, such as `*.*` (empty at the root).
 * @param key - The key.
 * @returns The path.
 */
function pathFor(prefix: string, key: string): string {
  if (SIMPLE_KEY.test(key)) {
    return prefix === '' ? key : `${prefix}.${key}`;
  }
  return `${prefix}["${key.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"]`;
}

/**
 * Builds the pino redact paths for a list of keys. Each key, in each spelling from `keyVariants`,
 * is matched at the root and up to three levels below it (`key`, `*.key`, `*.*.key`, `*.*.*.key`).
 * Keys with a hyphen use the bracket form (`*["set-cookie"]`).
 *
 * @param keys - The keys to redact, in camelCase.
 * @returns Paths for the pino `redact` option.
 */
export function buildRedactPaths(keys: readonly string[]): string[] {
  const prefixes = Array.from({ length: REDACTION_DEPTH + 1 }, (_, depth) =>
    Array.from({ length: depth }, () => '*').join('.'),
  );
  return keys.flatMap((key) =>
    keyVariants(key).flatMap((variant) => prefixes.map((prefix) => pathFor(prefix, variant))),
  );
}

/** The pino redact paths for `REDACTED_KEYS`. */
export const REDACT_PATHS: readonly string[] = buildRedactPaths(REDACTED_KEYS);
