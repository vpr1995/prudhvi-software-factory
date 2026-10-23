/**
 * The SSM parameter names that `platform/infra` writes and every project reads (ADR 0006).
 * The names are a contract. Do not rename or remove one. A change needs a human and a
 * coordinated deploy. `platform/infra` tests that it writes exactly `allPlatformParameterNames`.
 */

/** The deployment environments that have platform parameters. */
export const PLATFORM_ENVS = ['dev', 'staging', 'prod'] as const;

/** A deployment environment name. */
export type PlatformEnv = (typeof PLATFORM_ENVS)[number];

/** The path under `/platform/<env>/` for each platform value. */
export const PLATFORM_PARAMETER_PATHS = {
  userPoolId: 'cognito/user-pool-id',
  userPoolArn: 'cognito/user-pool-arn',
  hostedZoneId: 'dns/hosted-zone-id',
  zoneName: 'dns/zone-name',
  wildcardCertificateArn: 'acm/wildcard-certificate-arn',
} as const;

/** The key of one platform value. */
export type PlatformParameterKey = keyof typeof PLATFORM_PARAMETER_PATHS;

/** The SSM parameter name of each platform value for one environment. */
export type PlatformParameterNames = Readonly<Record<PlatformParameterKey, string>>;

/**
 * Checks that a text is a platform environment name.
 *
 * @param value - Any text, for example from a CDK context value.
 * @returns `true` when the text is `dev`, `staging` or `prod`.
 */
export function isPlatformEnv(value: string): value is PlatformEnv {
  const envNames: readonly string[] = PLATFORM_ENVS;
  return envNames.includes(value);
}

/**
 * Builds the SSM parameter name of one platform value.
 *
 * @param env - The environment.
 * @param key - The platform value.
 * @returns The name, for example `/platform/dev/cognito/user-pool-id`.
 */
export function platformParameterName(env: PlatformEnv, key: PlatformParameterKey): string {
  return `/platform/${env}/${PLATFORM_PARAMETER_PATHS[key]}`;
}

/**
 * Builds the SSM parameter names of all platform values for one environment.
 *
 * @param env - The environment.
 * @returns The name of each value, by key.
 */
export function platformParameterNames(env: PlatformEnv): PlatformParameterNames {
  return {
    userPoolId: platformParameterName(env, 'userPoolId'),
    userPoolArn: platformParameterName(env, 'userPoolArn'),
    hostedZoneId: platformParameterName(env, 'hostedZoneId'),
    zoneName: platformParameterName(env, 'zoneName'),
    wildcardCertificateArn: platformParameterName(env, 'wildcardCertificateArn'),
  };
}

/**
 * Lists every platform parameter name for one environment.
 *
 * @param env - The environment.
 * @returns All names, in the order of `PLATFORM_PARAMETER_PATHS`.
 */
export function allPlatformParameterNames(env: PlatformEnv): readonly string[] {
  return Object.values(platformParameterNames(env));
}
