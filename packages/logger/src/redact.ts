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
 * Reduces a key to lower case without `_` and `-`, so `API_KEY`, `ApiKey`, `apiKey` and `api-key`
 * give the same text.
 *
 * @param key - A key of a log object.
 * @returns The normalized key.
 */
function normalizeKey(key: string): string {
  return key.toLowerCase().replaceAll(/[_-]/g, '');
}

const NORMALIZED_KEYS: ReadonlySet<string> = new Set(REDACTED_KEYS.map((key) => normalizeKey(key)));

/**
 * Tells whether a log key holds a secret or personal data, whatever its case and separator style.
 *
 * @param key - A key of a log object.
 * @returns True when the value must be redacted.
 */
export function isRedactedKey(key: string): boolean {
  return NORMALIZED_KEYS.has(normalizeKey(key));
}

/**
 * Tells whether a value is a plain object, which the redaction can copy safely.
 *
 * @param value - Any value.
 * @returns True for `{}` and `Object.create(null)` objects.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Copies a log value and replaces the value of each secret key, whatever its case and separator
 * style. Pino redact paths match one exact spelling, so this covers the other spellings
 * (`API_KEY`, `ApiKey`, `Authorization`). It walks plain objects and arrays down to
 * `REDACTION_DEPTH` levels below the root. Other values (errors, dates, class instances) stay.
 *
 * @param value - A log value.
 * @param depth - How many object levels below this value are still searched.
 * @returns The copy, or the same value when it has nothing to walk.
 */
export function redactValue(value: unknown, depth: number = REDACTION_DEPTH): unknown {
  if (depth < 0) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item: unknown) => redactValue(item, depth - 1));
  }
  return isPlainObject(value) ? redactEntries(value, depth) : value;
}

/**
 * Copies a plain object and replaces the value of each secret key. See `redactValue`.
 *
 * @param record - A log object.
 * @param depth - How many object levels below this object are still searched.
 * @returns The copy.
 */
function redactEntries(record: Record<string, unknown>, depth: number): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [
      key,
      isRedactedKey(key) ? REDACTED_TEXT : redactValue(item, depth - 1),
    ]),
  );
}

/**
 * Redacts the object of a log call. See `redactValue`.
 *
 * @param record - The merged object of a log call.
 * @returns The redacted copy.
 */
export function redactRecord(record: Record<string, unknown>): Record<string, unknown> {
  return redactEntries(record, REDACTION_DEPTH);
}

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
