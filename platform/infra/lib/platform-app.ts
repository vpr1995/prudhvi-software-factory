import { Validations } from 'aws-cdk-lib';
import type { App } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';

import { loadPlatformConfig, readPlatformEnvironment } from './config/config.js';
import { PlatformStack } from './platform-stack.js';

/**
 * Adds the platform stack and the cdk-nag AwsSolutions checks to a CDK app.
 *
 * @param app - The CDK app.
 * @param envName - The value of the CDK context key `env`.
 * @returns The platform stack.
 */
export function addPlatformStack(app: App, envName: unknown): PlatformStack {
  const config = loadPlatformConfig(envName);
  Validations.of(app).addPlugins(new AwsSolutionsChecks(app));
  return new PlatformStack(app, `PlatformInfra-${config.env}`, {
    config,
    env: readPlatformEnvironment(),
    description: `Shared platform resources (${config.env}): Cognito user pool with Google sign-in.`,
  });
}
