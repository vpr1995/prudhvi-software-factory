import { Validations } from 'aws-cdk-lib';
import type { App } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';

import { loadSampleConfig, readSampleEnvironment } from './config/config.js';
import { SampleApiStack } from './sample-api-stack.js';

/**
 * Adds the sample API stack and the cdk-nag AwsSolutions checks to a CDK app.
 *
 * @param app - The CDK app.
 * @param envName - The value of the CDK context key `env`.
 * @returns The sample API stack.
 */
export function addSampleApiStack(app: App, envName: unknown): SampleApiStack {
  const config = loadSampleConfig(envName);
  Validations.of(app).addPlugins(new AwsSolutionsChecks(app));
  return new SampleApiStack(app, `SampleApi-${config.env}`, {
    config,
    env: readSampleEnvironment(),
    description: `The sample TypeScript, Python and Go APIs (${config.env}).`,
  });
}
