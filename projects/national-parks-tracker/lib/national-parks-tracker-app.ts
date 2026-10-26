import { Validations } from 'aws-cdk-lib';
import type { App } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';

import { NationalParksTrackerStack } from './national-parks-tracker-stack.js';

/**
 * Adds the national-parks-tracker stack and the cdk-nag AwsSolutions checks to a CDK app.
 *
 * @param app - The CDK app.
 * @returns The national-parks-tracker stack.
 */
export function addNationalParksTrackerStack(app: App): NationalParksTrackerStack {
  Validations.of(app).addPlugins(new AwsSolutionsChecks(app));
  return new NationalParksTrackerStack(app, 'NationalParksTracker', {
    env: { region: 'us-east-1' },
    description: 'The national-parks-tracker stack. It has no app resources yet.',
  });
}
