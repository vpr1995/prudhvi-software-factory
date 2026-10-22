import { z } from 'zod';

import type { FlagContext, FlagProvider } from './flags.js';

const TRUE_VALUES = new Set(['true', '1', 'on', 'yes']);
const FALSE_VALUES = new Set(['false', '0', 'off', 'no']);

const FlagRuleSchema = z.union([
  z.boolean(),
  z.object({
    enabled: z.boolean(),
    environments: z.array(z.string()).optional(),
    userIds: z.array(z.string()).optional(),
  }),
]);

const FlagDocumentSchema = z.record(z.string(), FlagRuleSchema);

/**
 * Turns a camelCase flag name into the environment variable name.
 *
 * @param flag - The flag name, for example `newNotesList`.
 * @param prefix - The variable prefix, for example `FLAG_`.
 * @returns The variable name, for example `FLAG_NEW_NOTES_LIST`.
 */
export function toEnvName(flag: string, prefix: string): string {
  return `${prefix}${flag.replaceAll(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()}`;
}

/**
 * Creates a provider that reads flags from environment variables.
 * `FLAG_NEW_NOTES_LIST=true` turns on the flag `newNotesList`.
 * Accepted values: `true`, `1`, `on`, `yes`, `false`, `0`, `off`, `no`. Other values are ignored.
 *
 * @param source - The variables. Pass `process.env` from your config module.
 * @param prefix - The variable prefix. Defaults to `FLAG_`.
 * @returns A flag provider.
 */
export function createEnvFlagProvider(
  source: Readonly<Record<string, string | undefined>>,
  prefix = 'FLAG_',
): FlagProvider {
  return {
    getValue: (flag) => {
      const raw = source[toEnvName(flag, prefix)]?.trim().toLowerCase();
      if (raw === undefined) {
        return;
      }
      if (TRUE_VALUES.has(raw)) {
        return true;
      }
      return FALSE_VALUES.has(raw) ? false : undefined;
    },
  };
}

/**
 * Creates a provider from a JSON document.
 *
 * ```json
 * { "newNotesList": true, "betaSearch": { "enabled": true, "environments": ["dev"], "userIds": ["u1"] } }
 * ```
 *
 * A flag with a rule object is on only when `enabled` is true and the context matches
 * `environments` and `userIds` (a missing list matches all).
 *
 * @param json - The JSON text. Invalid JSON or a wrong shape throws an error at start.
 * @returns A flag provider.
 */
export function createJsonFlagProvider(json: string): FlagProvider {
  const document = FlagDocumentSchema.parse(JSON.parse(json));
  return {
    getValue: (flag, context) => {
      const rule = document[flag];
      if (rule === undefined || typeof rule === 'boolean') {
        return rule;
      }
      return (
        rule.enabled &&
        matches(rule.environments, context.environment) &&
        matches(rule.userIds, context.userId)
      );
    },
  };
}

/**
 * Checks a context value against an allow list. A missing list matches all.
 *
 * @param allowed - The allow list.
 * @param value - The context value.
 * @returns `true` when the value is allowed.
 */
function matches(
  allowed: readonly string[] | undefined,
  value: FlagContext[keyof FlagContext],
): boolean {
  return allowed === undefined || (value !== undefined && allowed.includes(value));
}
