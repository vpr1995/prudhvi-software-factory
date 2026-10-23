import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { App } from 'aws-cdk-lib';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { describe, expect, it, vi } from 'vitest';

import { addPlatformStack } from '../lib/platform-app.js';

describe('addPlatformStack', () => {
  it('adds one stack named for the environment, in us-east-1', () => {
    const app = new App();

    const stack = addPlatformStack(app, 'staging');

    expect(stack.stackName).toBe('PlatformInfra-staging');
    expect(stack.region).toBe('us-east-1');
    expect(app.node.children).toContain(stack);
  });

  it('rejects a missing environment', () => {
    expect(() => addPlatformStack(new App(), undefined)).toThrow(/-c env=dev/);
  });

  it.each(['dev', 'staging', 'prod'])('synthesizes the %s stack with the checks on', (env) => {
    const app = new App({ outdir: mkdtempSync(join(tmpdir(), 'platform-app-')) });
    const stack = addPlatformStack(app, env);

    const assembly = app.synth();

    expect(assembly.getStackByName(stack.stackName).template).toHaveProperty('Resources');
  });

  it('runs the AwsSolutions checks at synth, so a new finding stops the synth', () => {
    const app = new App({ outdir: mkdtempSync(join(tmpdir(), 'platform-app-')) });
    const stack = addPlatformStack(app, 'dev');
    // A bucket without any setting breaks AwsSolutions rules (for example S1 and S10).
    new Bucket(stack, 'BadBucket');

    expect(() => app.synth()).toThrow(/AwsSolutions-S/);
  });
});

describe('bin/app', () => {
  it('reads the environment from the CDK context and synthesizes', async () => {
    const outdir = mkdtempSync(join(tmpdir(), 'platform-bin-'));
    vi.stubEnv('CDK_OUTDIR', outdir);
    vi.stubEnv('CDK_CONTEXT_JSON', JSON.stringify({ env: 'dev' }));
    vi.resetModules();

    await import('../bin/app.js');

    expect(existsSync(join(outdir, 'PlatformInfra-dev.template.json'))).toBe(true);
  });

  it('fails without the env context', async () => {
    vi.stubEnv('CDK_OUTDIR', mkdtempSync(join(tmpdir(), 'platform-bin-')));
    vi.resetModules();

    await expect(import('../bin/app.js')).rejects.toThrow(/-c env=dev/);
  });
});
