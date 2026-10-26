import { CfnWaitConditionHandle, Stack } from 'aws-cdk-lib';
import type { StackProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';

/**
 * The stack of the national-parks-tracker project. It has no app resources yet.
 * CloudFormation rejects a template with no resources, so the stack holds one placeholder
 * (a wait condition handle, no cost). Remove it when the stack gets its first real resource.
 */
export class NationalParksTrackerStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
    new CfnWaitConditionHandle(this, 'Placeholder');
  }
}
