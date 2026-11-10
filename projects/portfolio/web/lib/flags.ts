// The feature flags of the site. Server only: the flag is read at build time, by a Server Component
// or a build script. Version 1 has no reader, so no client bundle holds this module (R-16).
import { createEnvFlagProvider, createFlagClient, defineFlags } from '@vprprudhvi/shared-flags';
import type { FlagClient } from '@vprprudhvi/shared-flags';

import { loadFlagEnvironment } from '../config';
import type { FlagEnvironment } from '../config';

/** The flags of the site. Each new user-visible behavior has one (coding-conventions F.3). */
export const flagRegistry = defineFlags({
  portfolioChat: {
    defaultValue: false,
    description: 'Turns on the chat about the portfolio (version 2).',
  },
});

/**
 * Creates the flag client for a flag record.
 *
 * @param environment - The `FLAG_` variables. `FLAG_PORTFOLIO_CHAT=true` turns on `portfolioChat`.
 * @returns A flag client for the site flags.
 */
export function createFlags(environment: FlagEnvironment): FlagClient<typeof flagRegistry> {
  return createFlagClient(flagRegistry, [createEnvFlagProvider(environment, 'FLAG_')]);
}

/**
 * Tells if the chat is on. It is off unless `FLAG_PORTFOLIO_CHAT` is a true word.
 *
 * @param environment - The `FLAG_` variables. Defaults to the process environment.
 * @returns `true` when the chat flag is on.
 */
export function isChatEnabled(environment: FlagEnvironment = loadFlagEnvironment()): boolean {
  return createFlags(environment).isEnabled('portfolioChat');
}
