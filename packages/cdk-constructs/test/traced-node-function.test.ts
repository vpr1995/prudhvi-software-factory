import { Template } from 'aws-cdk-lib/assertions';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { describe, expect, it } from 'vitest';

import { NODE_RUNTIME, TracedNodeFunction } from '../src/traced-node-function.js';

import { captureAssetCall } from './support/assets.js';
import { PATHS, newStack, nodeProps } from './support/functions.js';

/** Reads the handler of the one function in the stack. */
function handlerOf(stack: ReturnType<typeof newStack>): unknown {
  const [resource] = Object.values(
    Template.fromStack(stack).findResources('AWS::Lambda::Function'),
  );
  return (resource?.['Properties'] as Record<string, unknown> | undefined)?.['Handler'];
}

describe('TracedNodeFunction', () => {
  it('runs on Node.js 24', () => {
    expect(NODE_RUNTIME).toBe(Runtime.NODEJS_24_X);
  });

  it('points the handler at the exported name in the bundle file index.mjs', () => {
    const stack = newStack();
    new TracedNodeFunction(stack, 'Api', nodeProps());

    expect(handlerOf(stack)).toBe('index.handler');
  });

  it('takes the handler name from the props', () => {
    const stack = newStack();
    new TracedNodeFunction(stack, 'Api', { ...nodeProps(), handler: 'main' });

    expect(handlerOf(stack)).toBe('index.main');
  });

  it('bundles with esbuild as an ES module with source maps for Node.js 24', () => {
    const [directory, options] = captureAssetCall((stack) => {
      new TracedNodeFunction(stack, 'Api', nodeProps());
    });
    const command = (options?.bundling?.command ?? []).join(' ');

    expect(directory).toBe(PATHS.nodeProjectRoot);
    expect(command).toContain("'--format=esm'");
    expect(command).toContain("'--sourcemap'");
    expect(command).toContain("'--target=node24'");
    expect(command).toContain("'--outfile=/asset-output/index.mjs'");
    expect(command).toContain("'--main-fields=module,main'");
    expect(command).toContain('--banner:js=import { createRequire as __createRequire }');
    expect(command).toContain('__createRequire(import.meta.url)');
  });

  it('turns on source maps at run time, and lets the caller set NODE_OPTIONS', () => {
    const variables = (stack: ReturnType<typeof newStack>): unknown => {
      const [resource] = Object.values(
        Template.fromStack(stack).findResources('AWS::Lambda::Function'),
      );
      return (resource?.['Properties'] as { Environment: { Variables: unknown } }).Environment
        .Variables;
    };
    const first = newStack();
    new TracedNodeFunction(first, 'Api', nodeProps());
    const second = newStack();
    new TracedNodeFunction(second, 'Api', nodeProps({ environment: { NODE_OPTIONS: '--x' } }));

    expect(variables(first)).toMatchObject({ NODE_OPTIONS: '--enable-source-maps' });
    expect(variables(second)).toMatchObject({ NODE_OPTIONS: '--x' });
  });

  it('bundles on this machine first', () => {
    const [, options] = captureAssetCall((stack) => {
      new TracedNodeFunction(stack, 'Api', nodeProps());
    });

    expect(options?.bundling?.local).toBeDefined();
  });

  it('keeps the format and the source map when the caller passes more settings', () => {
    const [, options] = captureAssetCall((stack) => {
      new TracedNodeFunction(stack, 'Api', {
        ...nodeProps(),
        bundling: { externalModules: ['sharp'], minify: true },
      });
    });
    const command = (options?.bundling?.command ?? []).join(' ');

    expect(command).toContain("'--external:sharp'");
    expect(command).toContain("'--minify'");
    expect(command).toContain("'--format=esm'");
    expect(command).toContain("'--sourcemap'");
  });

  it('lets the caller replace the banner', () => {
    const [, options] = captureAssetCall((stack) => {
      new TracedNodeFunction(stack, 'Api', {
        ...nodeProps(),
        bundling: { banner: '/* custom */' },
      });
    });
    const command = (options?.bundling?.command ?? []).join(' ');

    expect(command).toContain('/* custom */');
    expect(command).not.toContain('createRequire');
  });

  it('needs a lock file inside the project root', () => {
    const stack = newStack();

    expect(
      () =>
        new TracedNodeFunction(stack, 'Api', {
          ...nodeProps(),
          projectRoot: PATHS.nodeProjectRoot.concat('/packages/cdk-constructs/test/fixtures'),
        }),
    ).toThrow(/should be under projectRoot/);
  });
});
