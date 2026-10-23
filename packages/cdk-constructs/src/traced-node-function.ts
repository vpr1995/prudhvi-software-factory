import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import type { BundlingOptions } from 'aws-cdk-lib/aws-lambda-nodejs';
import type { Construct } from 'constructs';

import { TracedFunctionBase } from './traced-function-base.js';
import type { TracedFunctionBaseProps } from './traced-function-base.js';

/** The Node.js runtime of `TracedNodeFunction`. */
export const NODE_RUNTIME = Runtime.NODEJS_24_X;

/**
 * Code that runs first in the bundle. Some packages in a bundle call `require`. An ES module has
 * no `require`, so this line makes one.
 */
export const NODE_REQUIRE_BANNER =
  "import { createRequire as __createRequire } from 'node:module';\n" +
  'const require = __createRequire(import.meta.url);';

/** Settings for `TracedNodeFunction`. */
export type TracedNodeFunctionProps = TracedFunctionBaseProps & {
  /** The path of the TypeScript or JavaScript file that exports the handler. */
  readonly entry: string;
  /** The name of the exported handler. Defaults to `handler`. */
  readonly handler?: string;
  /**
   * The path of the lock file of the package manager. `NodejsFunction` needs it, and it does not
   * find the file of Rush. In this repo use `common/config/rush/pnpm-lock.yaml`.
   */
  readonly depsLockFilePath?: string;
  /**
   * The root folder of the bundle. The lock file and `entry` must be inside it. Defaults to the
   * folder of the lock file. In this repo the lock file is in `common/config/rush`, so set
   * `projectRoot` to the root folder of the repo.
   */
  readonly projectRoot?: string;
  /**
   * More esbuild settings. `format` (ES module) and `sourceMap` (on) are fixed. `banner` and
   * `mainFields` have defaults for ES modules.
   */
  readonly bundling?: Omit<BundlingOptions, 'format' | 'sourceMap'>;
};

/**
 * A Node.js Lambda function with tracing (see `TracedFunctionBase`). CDK bundles the code with
 * esbuild on this machine, as one ES module with source maps. It runs on Node.js 24 and arm64.
 * It sets `NODE_OPTIONS=--enable-source-maps`, so stack traces show the TypeScript lines. A caller
 * can set its own `NODE_OPTIONS` in `environment`.
 *
 * Bundling needs `esbuild` in the `node_modules` of the project that runs the CDK app. Without
 * it CDK falls back to Docker.
 */
export class TracedNodeFunction extends TracedFunctionBase {
  /** The Lambda function. */
  public readonly function: NodejsFunction;

  /**
   * @param scope - The parent construct.
   * @param id - The construct ID, in PascalCase.
   * @param props - The function settings.
   */
  public constructor(scope: Construct, id: string, props: TracedNodeFunctionProps) {
    super(scope, id, props);
    this.function = new NodejsFunction(this, 'Function', {
      ...this.functionOptions,
      // Without this flag Node.js ignores the source map in the bundle.
      environment: { NODE_OPTIONS: '--enable-source-maps', ...this.functionOptions.environment },
      runtime: NODE_RUNTIME,
      entry: props.entry,
      handler: props.handler ?? 'handler',
      ...(props.depsLockFilePath === undefined ? {} : { depsLockFilePath: props.depsLockFilePath }),
      ...(props.projectRoot === undefined ? {} : { projectRoot: props.projectRoot }),
      bundling: {
        banner: NODE_REQUIRE_BANNER,
        mainFields: ['module', 'main'],
        ...props.bundling,
        format: OutputFormat.ESM,
        sourceMap: true,
      },
    });
    this.completeSetup();
  }
}
