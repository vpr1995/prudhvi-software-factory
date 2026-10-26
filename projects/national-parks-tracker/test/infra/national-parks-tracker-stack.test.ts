import { App, CfnResource } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';

import { NationalParksTrackerStack } from '../../lib/national-parks-tracker-stack.js';

describe('NationalParksTrackerStack', () => {
  it('has only the placeholder resource', () => {
    const stack = new NationalParksTrackerStack(new App(), 'TestNationalParksTracker');

    const resources = stack.node.findAll().filter((child) => child instanceof CfnResource);
    expect(resources).toHaveLength(1);
    Template.fromStack(stack).resourceCountIs('AWS::CloudFormation::WaitConditionHandle', 1);
  });
});
