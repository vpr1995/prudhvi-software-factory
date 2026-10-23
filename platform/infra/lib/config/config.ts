import { isPlatformEnv } from '@vprprudhvi/shared-cdk-constructs';

import type { PlatformConfig } from './platform-config.js';
import { productionConfig } from './prod.js';

/** The only AWS region of the platform. */
export const PLATFORM_REGION = 'us-east-1';

/** The CDK environment of the platform stack. The account is unset until the CLI knows it. */
export type PlatformEnvironment = {
  readonly account?: string;
  readonly region: typeof PLATFORM_REGION;
};

const configs = { prod: productionConfig } as const;

/**
 * Reads the account and the region of the stack. This is the only place that reads the
 * environment. The CDK CLI sets `CDK_DEFAULT_ACCOUNT`. Without it (offline synth) the account
 * stays unset, and the template uses the `AWS::AccountId` pseudo parameter.
 *
 * @returns The CDK environment with the fixed region `us-east-1`.
 */
export function readPlatformEnvironment(): PlatformEnvironment {
  const account = process.env['CDK_DEFAULT_ACCOUNT'];
  return account === undefined || account === ''
    ? { region: PLATFORM_REGION }
    : { account, region: PLATFORM_REGION };
}

/**
 * Picks the config of one environment. The platform deploys only `prod`.
 *
 * @param envName - The value of the CDK context key `env` (`-c env=prod`).
 * @returns The platform config.
 * @throws When `envName` is not `prod`.
 */
export function loadPlatformConfig(envName: unknown): PlatformConfig {
  if (typeof envName !== 'string' || !isPlatformEnv(envName)) {
    throw new Error(`Set the environment with "-c env=prod". Got: ${String(envName)}`);
  }
  return configs[envName];
}
