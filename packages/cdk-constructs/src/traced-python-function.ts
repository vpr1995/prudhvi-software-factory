import { PythonFunction } from '@aws-cdk/aws-lambda-python-alpha';
import type { BundlingOptions } from '@aws-cdk/aws-lambda-python-alpha';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import type { Construct } from 'constructs';

import { TracedFunctionBase } from './traced-function-base.js';
import type { TracedFunctionBaseProps } from './traced-function-base.js';

/** The Python runtime of `TracedPythonFunction`. */
export const PYTHON_RUNTIME = Runtime.PYTHON_3_14;

/**
 * The files and folders that the bundle never copies by default: virtual environments and caches.
 * Without them, a `.venv` folder in `entry` would go into the zip file.
 */
export const PYTHON_DEFAULT_ASSET_EXCLUDES = [
  '.venv',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.coverage',
  'coverage',
];

/** Settings for `TracedPythonFunction`. */
export type TracedPythonFunctionProps = TracedFunctionBaseProps & {
  /**
   * The folder with the `pyproject.toml` and `uv.lock` files, for example `src/api-py`. Do not keep
   * a `requirements.txt` file in it. CDK looks for `requirements.txt` before `uv.lock`, so it
   * would use that file and not the lock file.
   */
  readonly entry: string;
  /**
   * The Python file with the handler, relative to `entry`, for example `src/sample_api/handler.py`.
   * The zip file has the same folders as `entry`, and the handler path comes from this value:
   * `src/sample_api/handler.py` gives `src.sample_api.handler`. Code in a `src` folder that
   * imports `sample_api` needs `PYTHONPATH=/var/task/src` in `environment`.
   */
  readonly index: string;
  /** The name of the handler function in `index`. Defaults to `handler`. */
  readonly handler?: string;
  /**
   * More bundling settings. `assetExcludes` defaults to `PYTHON_DEFAULT_ASSET_EXCLUDES`. Setting it
   * replaces the list.
   */
  readonly bundling?: BundlingOptions;
};

/**
 * A Python Lambda function with tracing (see `TracedFunctionBase`). It runs on Python 3.14 and
 * arm64. CDK installs the locked dependencies with `uv` and copies the code.
 *
 * A real bundle needs Docker. CDK runs `uv` inside a build image, and it builds the image when the
 * stack bundles. A stack that does not bundle (the context value `aws:cdk:bundling-stacks` without
 * the stack) needs no Docker.
 */
export class TracedPythonFunction extends TracedFunctionBase {
  /** The Lambda function. */
  public readonly function: PythonFunction;

  /**
   * @param scope - The parent construct.
   * @param id - The construct ID, in PascalCase.
   * @param props - The function settings.
   */
  public constructor(scope: Construct, id: string, props: TracedPythonFunctionProps) {
    super(scope, id, props);
    this.function = new PythonFunction(this, 'Function', {
      ...this.functionOptions,
      runtime: PYTHON_RUNTIME,
      entry: props.entry,
      index: props.index,
      ...(props.handler === undefined ? {} : { handler: props.handler }),
      bundling: { assetExcludes: PYTHON_DEFAULT_ASSET_EXCLUDES, ...props.bundling },
    });
    this.completeSetup();
  }
}
