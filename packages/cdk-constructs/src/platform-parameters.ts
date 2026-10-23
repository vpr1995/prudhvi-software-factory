/**
 * The SSM parameter names that `platform/infra` writes and every project reads (ADR 0006).
 * The names are a contract. Do not rename or remove one. A change needs a human and a
 * coordinated deploy. `platform/infra` tests that it writes exactly `writtenPlatformParameterNames`.
 *
 * The contract has two groups. The Cognito names are written now. The DNS and ACM names are
 * reserved for later: no Route53 zone and no certificate exist yet, so nothing writes them and a
 * project must not read them (see `readPlatformDns` and `readPlatformCertificate`).
 */

/**
 * The environments that have platform parameters (`/platform/<env>/...`). The platform deploys
 * only `prod`. Pass a `PlatformEnv` to the `readPlatform*` readers and the name builders.
 */
export const PLATFORM_ENVS = ['prod'] as const;

/** A platform environment name. */
export type PlatformEnv = (typeof PLATFORM_ENVS)[number];

/**
 * The environments of the project stacks. `local` is the stack for the web app and the API that
 * run on this machine against the cloud resources. `prod` is the deployed stack. Both read the
 * platform parameters of `prod`.
 *
 * The two lists are separate types on purpose. The readers read SSM with a deploy-time token, so a
 * wrong environment would synthesize and fail only at deploy. With two types, it does not compile.
 */
export const DEPLOY_ENVS = ['local', 'prod'] as const;

/** A project stack environment name. */
export type DeployEnv = (typeof DEPLOY_ENVS)[number];

/** The path under `/platform/<env>/` for each platform value. */
export const PLATFORM_PARAMETER_PATHS = {
  userPoolId: 'cognito/user-pool-id',
  userPoolArn: 'cognito/user-pool-arn',
  /** The host name of the hosted sign-in domain, without a scheme. */
  userPoolDomain: 'cognito/user-pool-domain',
  hostedZoneId: 'dns/hosted-zone-id',
  zoneName: 'dns/zone-name',
  wildcardCertificateArn: 'acm/wildcard-certificate-arn',
} as const;

/** The keys that `platform/infra` writes now. The DNS and ACM keys are reserved for later. */
export const PLATFORM_WRITTEN_KEYS = ['userPoolId', 'userPoolArn', 'userPoolDomain'] as const;

/** The key of one platform value. */
export type PlatformParameterKey = keyof typeof PLATFORM_PARAMETER_PATHS;

/** The SSM parameter name of each platform value for one environment. */
export type PlatformParameterNames = Readonly<Record<PlatformParameterKey, string>>;

/**
 * Checks that a text is a platform environment name.
 *
 * @param value - Any text, for example from a CDK context value.
 * @returns `true` when the text is `prod`.
 */
export function isPlatformEnv(value: string): value is PlatformEnv {
  const envNames: readonly string[] = PLATFORM_ENVS;
  return envNames.includes(value);
}

/**
 * Checks that a text is a project stack environment name.
 *
 * @param value - Any text, for example from a CDK context value.
 * @returns `true` when the text is `local` or `prod`.
 */
export function isDeployEnv(value: string): value is DeployEnv {
  const envNames: readonly string[] = DEPLOY_ENVS;
  return envNames.includes(value);
}

/**
 * Builds the SSM parameter name of one platform value.
 *
 * @param env - The environment.
 * @param key - The platform value.
 * @returns The name, for example `/platform/prod/cognito/user-pool-id`.
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
    userPoolDomain: platformParameterName(env, 'userPoolDomain'),
    hostedZoneId: platformParameterName(env, 'hostedZoneId'),
    zoneName: platformParameterName(env, 'zoneName'),
    wildcardCertificateArn: platformParameterName(env, 'wildcardCertificateArn'),
  };
}

/**
 * Lists the names that `platform/infra` writes today for one environment.
 *
 * @param env - The environment.
 * @returns The Cognito names, in the order of `PLATFORM_WRITTEN_KEYS`.
 */
export function writtenPlatformParameterNames(env: PlatformEnv): readonly string[] {
  return PLATFORM_WRITTEN_KEYS.map((key) => platformParameterName(env, key));
}

/**
 * Lists every platform parameter name of the contract for one environment, written or reserved.
 *
 * @param env - The environment.
 * @returns All names, in the order of `PLATFORM_PARAMETER_PATHS`.
 */
export function allPlatformParameterNames(env: PlatformEnv): readonly string[] {
  return Object.values(platformParameterNames(env));
}
