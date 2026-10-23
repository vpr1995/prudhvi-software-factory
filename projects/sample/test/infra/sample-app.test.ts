import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { App } from 'aws-cdk-lib';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { describe, expect, it } from 'vitest';

import { addSampleApiStack } from '../../lib/sample-app.js';

const NO_BUNDLING = { 'aws:cdk:bundling-stacks': [] };

/** Makes an app that writes to a temp folder and does not bundle. */
function newApp(context: Record<string, unknown> = {}): App {
  return new App({
    outdir: mkdtempSync(join(tmpdir(), 'sample-app-')),
    context: { ...NO_BUNDLING, ...context },
  });
}

/** The time that one stack build can take: it hashes the Python and Go code. */
const STACK_TIMEOUT_MS = 30_000;

describe('addSampleApiStack', () => {
  it(
    'adds one stack named for the environment, in us-east-1',
    () => {
      const app = newApp();

      const stack = addSampleApiStack(app, 'staging');

      expect(stack.stackName).toBe('SampleApi-staging');
      expect(stack.region).toBe('us-east-1');
      expect(app.node.children).toContain(stack);
    },
    STACK_TIMEOUT_MS,
  );

  it('rejects a missing environment', () => {
    expect(() => addSampleApiStack(newApp(), undefined)).toThrow(/-c env=dev/);
  });

  it.each(['dev', 'staging', 'prod'])(
    'synthesizes the %s stack with the checks on',
    (env) => {
      const app = newApp();
      const stack = addSampleApiStack(app, env);

      const assembly = app.synth();

      expect(assembly.getStackByName(stack.stackName).template).toHaveProperty('Resources');
    },
    STACK_TIMEOUT_MS,
  );

  it(
    'runs the AwsSolutions checks at synth, so a new finding stops the synth',
    () => {
      const app = newApp();
      const stack = addSampleApiStack(app, 'dev');
      // A bucket without any setting breaks AwsSolutions rules (for example S1 and S10).
      new Bucket(stack, 'BadBucket');

      expect(() => app.synth()).toThrow(/AwsSolutions-S/);
    },
    STACK_TIMEOUT_MS,
  );
});
