/** Who or what a flag decision is for. Every field is optional. */
export type FlagContext = {
  /** The deployment environment, for example `dev` or `prod`. */
  readonly environment?: string;
  /** The user id. Use it for per-user rollout. */
  readonly userId?: string;
};

/** The definition of one flag. */
export type FlagDefinition = {
  /** The value when no provider has an opinion. New behavior starts with `false`. */
  readonly defaultValue: boolean;
  /** What the flag turns on. One short sentence. */
  readonly description: string;
};

/** A source of flag values, for example environment variables or a JSON document. */
export type FlagProvider = {
  /**
   * Reads the value of one flag.
   *
   * @param flag - The flag name.
   * @param context - Who or what the decision is for.
   * @returns `true` or `false`, or `undefined` when the provider has no opinion.
   */
  readonly getValue: (flag: string, context: FlagContext) => boolean | undefined;
};

/** The flag names of a registry. */
export type FlagName<TRegistry> = Extract<keyof TRegistry, string>;

/** A client that answers `isEnabled` for the flags of one registry. */
export type FlagClient<TRegistry> = {
  /**
   * Tells if a flag is on.
   *
   * @param flag - A flag name from the registry. A wrong name is a type error.
   * @param context - Who or what the decision is for.
   * @returns `true` when the flag is on.
   */
  readonly isEnabled: (flag: FlagName<TRegistry>, context?: FlagContext) => boolean;
};

/**
 * Declares the flags of a project. The keys become the typed flag names.
 *
 * @param registry - One definition for each flag. Use camelCase keys.
 * @returns The same registry, with literal key types.
 */
export function defineFlags<const TRegistry extends Readonly<Record<string, FlagDefinition>>>(
  registry: TRegistry,
): TRegistry {
  return registry;
}

/**
 * Creates a client for a flag registry. The first provider with an opinion wins.
 * When no provider has an opinion, the flag has its default value.
 *
 * @param registry - The flags from `defineFlags`.
 * @param providers - Flag sources, in order of priority.
 * @returns A flag client.
 */
export function createFlagClient<TRegistry extends Readonly<Record<string, FlagDefinition>>>(
  registry: TRegistry,
  providers: readonly FlagProvider[],
): FlagClient<TRegistry> {
  return {
    isEnabled: (flag, context = {}) => {
      for (const provider of providers) {
        const isOn = provider.getValue(flag, context);
        if (isOn !== undefined) {
          return isOn;
        }
      }
      return registry[flag]?.defaultValue ?? false;
    },
  };
}
