import { Validations } from 'aws-cdk-lib';
import type { App } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';

import { loadSampleConfig, readSampleEnvironment } from './config/config.js';
import { SampleApiStack } from './sample-api-stack.js';

/**
 * Adds the sample API stack and the cdk-nag AwsSolutions checks to a CDK app.
 *
 * @param app - The CDK app.
 * @param envName - The value of the CDK context key `env` (`-c env=local` or `-c env=prod`).
 * @returns The sample API stack.
 * @throws When `envName` is not `local` or `prod`.
 */
export function addSampleApiStack(app: App, envName: unknown): SampleApiStack {
  const config = loadSampleConfig(envName);
  Validations.of(app).addPlugins(new AwsSolutionsChecks(app));
  return new SampleApiStack(app, `SampleApi-${config.env}`, {
    config,
    env: readSampleEnvironment(),
    description: config.deployApis
      ? `The sample TypeScript, Python and Go APIs (${config.env}).`
      : `The sample app client for the web app and the API on this machine (${config.env}).`,
  });
}
