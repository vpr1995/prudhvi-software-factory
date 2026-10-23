import { isPlatformEnv } from '@vprprudhvi/shared-cdk-constructs';

import { developmentConfig } from './dev.js';
import { productionConfig } from './prod.js';
import type { SampleConfig } from './sample-config.js';
import { stagingConfig } from './staging.js';

/** The only AWS region of the project. */
export const SAMPLE_REGION = 'us-east-1';

/** The CDK environment of the sample stacks. The account is unset until the CLI knows it. */
export type SampleEnvironment = {
  readonly account?: string;
  readonly region: typeof SAMPLE_REGION;
};

const configs = { dev: developmentConfig, staging: stagingConfig, prod: productionConfig } as const;

/**
 * Reads the account and the region of the stacks. This is the only place that reads the
 * environment. The CDK CLI sets `CDK_DEFAULT_ACCOUNT`. Without it (offline synth) the account
 * stays unset, and the template uses the `AWS::AccountId` pseudo parameter.
 *
 * @returns The CDK environment with the fixed region `us-east-1`.
 */
export function readSampleEnvironment(): SampleEnvironment {
  const account = process.env['CDK_DEFAULT_ACCOUNT'];
  return account === undefined || account === ''
    ? { region: SAMPLE_REGION }
    : { account, region: SAMPLE_REGION };
}

/**
 * Picks the config of one environment.
 *
 * @param envName - The value of the CDK context key `env` (`-c env=dev`).
 * @returns The sample config.
 * @throws When `envName` is not `dev`, `staging` or `prod`.
 */
export function loadSampleConfig(envName: unknown): SampleConfig {
  if (typeof envName !== 'string' || !isPlatformEnv(envName)) {
    throw new Error(
      `Set the environment with "-c env=dev", "-c env=staging" or "-c env=prod". Got: ${String(envName)}`,
    );
  }
  return configs[envName];
}
