import { App } from 'aws-cdk-lib';
import { describe, expect, it } from 'vitest';

import { addNationalParksTrackerStack } from '../../lib/national-parks-tracker-app.js';

describe('addNationalParksTrackerStack', () => {
  it('adds one stack in us-east-1', () => {
    const app = new App();

    const stack = addNationalParksTrackerStack(app);

    expect(stack.region).toBe('us-east-1');
    expect(app.node.children).toContain(stack);
  });
});
