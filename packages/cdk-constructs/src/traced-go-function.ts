import { GoFunction } from '@aws-cdk/aws-lambda-go-alpha';
import type { BundlingOptions } from '@aws-cdk/aws-lambda-go-alpha';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import type { Construct } from 'constructs';

import { TracedFunctionBase } from './traced-function-base.js';
import type { TracedFunctionBaseProps } from './traced-function-base.js';

/** The runtime of `TracedGoFunction`. The Go program is the `bootstrap` file. */
export const GO_RUNTIME = Runtime.PROVIDED_AL2023;

/** Settings for `TracedGoFunction`. */
export type TracedGoFunctionProps = TracedFunctionBaseProps & {
  /** The folder with the `go.mod` file, for example `src/api-go`. */
  readonly moduleDir: string;
  /** The folder of the `main` package, inside `moduleDir`, for example `src/api-go/cmd/sample-api`. */
  readonly entry: string;
  /** More build settings. `cgoEnabled` is fixed to off. */
  readonly bundling?: Omit<BundlingOptions, 'cgoEnabled'>;
};

/**
 * A Go Lambda function with tracing (see `TracedFunctionBase`). It runs on `provided.al2023` and
 * arm64. CDK builds the program with `go build` on this machine, with cgo off. The output file is
 * `bootstrap`.
 *
 * When the `go` tool is missing, CDK builds a Docker image at construction time. A caller can set
 * `bundling.dockerImage` to use its own image.
 */
export class TracedGoFunction extends TracedFunctionBase {
  /** The Lambda function. */
  public readonly function: GoFunction;

  /**
   * @param scope - The parent construct.
   * @param id - The construct ID, in PascalCase.
   * @param props - The function settings.
   */
  public constructor(scope: Construct, id: string, props: TracedGoFunctionProps) {
    super(scope, id, props);
    this.function = new GoFunction(this, 'Function', {
      ...this.functionOptions,
      runtime: GO_RUNTIME,
      moduleDir: props.moduleDir,
      entry: props.entry,
      bundling: { ...props.bundling, cgoEnabled: false },
    });
    this.completeSetup();
  }
}
