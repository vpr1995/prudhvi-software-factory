import { DockerImage } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { describe, expect, it } from 'vitest';

import { GO_RUNTIME, TracedGoFunction } from '../src/traced-go-function.js';

import { captureAssetCall } from './support/assets.js';
import { PATHS, goProps, newStack } from './support/functions.js';

describe('TracedGoFunction', () => {
  it('runs on provided.al2023 with the handler bootstrap', () => {
    const stack = newStack();
    new TracedGoFunction(stack, 'Api', goProps());

    expect(GO_RUNTIME).toBe(Runtime.PROVIDED_AL2023);
    expect(
      Object.values(Template.fromStack(stack).findResources('AWS::Lambda::Function')),
    ).toMatchObject([
      {
        Properties: { Runtime: 'provided.al2023', Handler: 'bootstrap', Architectures: ['arm64'] },
      },
    ]);
  });

  it('builds for linux arm64 with cgo off, from the folder of the go.mod file', () => {
    const [directory, options] = captureAssetCall((stack) => {
      new TracedGoFunction(stack, 'Api', goProps());
    });

    expect(directory).toBe(PATHS.goModule);
    expect(options?.bundling?.environment).toMatchObject({
      CGO_ENABLED: '0',
      GOARCH: 'arm64',
      GOOS: 'linux',
    });
    expect(options?.bundling?.command?.join(' ')).toContain(
      "-o '/asset-output/bootstrap' './cmd/api'",
    );
  });

  it('builds on this machine first', () => {
    const [, options] = captureAssetCall((stack) => {
      new TracedGoFunction(stack, 'Api', goProps());
    });

    expect(options?.bundling?.local).toBeDefined();
  });

  it('passes more build settings to the build and keeps cgo off', () => {
    const [, options] = captureAssetCall((stack) => {
      new TracedGoFunction(stack, 'Api', {
        ...goProps(),
        bundling: {
          goBuildFlags: ['-trimpath'],
          dockerImage: DockerImage.fromRegistry('golang:1.27'),
        },
      });
    });

    expect(options?.bundling?.command?.join(' ')).toContain('-trimpath');
    expect(options?.bundling?.image.image).toBe('dummy');
    expect(options?.bundling?.environment).toMatchObject({ CGO_ENABLED: '0' });
  });

  it('rejects a module folder without a go.mod file', () => {
    const stack = newStack();

    expect(
      () => new TracedGoFunction(stack, 'Api', { ...goProps(), moduleDir: PATHS.goEntry }),
    ).toThrow(/go\.mod file at .* doesn't exist/);
  });
});
