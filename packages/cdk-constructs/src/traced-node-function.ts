import { join } from 'node:path';

import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import type { BundlingOptions, ICommandHooks } from 'aws-cdk-lib/aws-lambda-nodejs';
import type { Construct } from 'constructs';

import { findRepositoryRoot } from './repository-root.js';
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

/** The path of the Rush lock file, relative to the repo root folder. */
export const RUSH_LOCK_FILE = join('common', 'config', 'rush', 'pnpm-lock.yaml');

/**
 * The name of the marker file that the bundle hooks write next to the temporary `package.json`.
 * The marker shows that the hooks made that `package.json`, so they remove only their own file.
 */
export const BUNDLE_PACKAGE_JSON_MARKER = '.cdk-bundle-package-json';

/** Settings for `TracedNodeFunction`. */
export type TracedNodeFunctionProps = TracedFunctionBaseProps & {
  /** The path of the TypeScript or JavaScript file that exports the handler. */
  readonly entry: string;
  /** The name of the exported handler. Defaults to `handler`. */
  readonly handler?: string;
  /**
   * The path of the lock file of the package manager. Defaults to the Rush lock file,
   * `common/config/rush/pnpm-lock.yaml` in the repo root folder. The default assumes that this
   * package is at `packages/cdk-constructs` in a Rush repo. Set it when that is not true.
   */
  readonly depsLockFilePath?: string;
  /**
   * The root folder of the bundle. The lock file and `entry` must be inside it. Defaults to the
   * repo root folder. The default assumes that this package is at `packages/cdk-constructs` in a
   * Rush repo. Set it when that is not true.
   */
  readonly projectRoot?: string;
  /**
   * More esbuild settings. `format` (ES module) and `sourceMap` (on) are fixed. `banner` and
   * `mainFields` have defaults for ES modules. The `commandHooks` of the caller run between the
   * steps of this construct: its `package.json` step runs first in `beforeBundling` and its
   * clean-up step runs last in `afterBundling`.
   */
  readonly bundling?: Omit<BundlingOptions, 'format' | 'sourceMap'>;
};

/** The bundle root and the lock file of a `TracedNodeFunction`. */
export type BundleRoots = {
  /** The root folder of the bundle. */
  readonly projectRoot: string;
  /** The path of the lock file. */
  readonly depsLockFilePath: string;
};

/**
 * Gives the bundle root and the lock file of a function. A value in `props` wins. A missing value
 * defaults to the repo root folder (see `findRepositoryRoot`) or the Rush lock file in it. The repo root
 * is found only when a value is missing. `NodejsFunction` fails when the lock file is missing.
 *
 * @param props - The optional overrides.
 * @returns The bundle root and the lock file.
 * @throws When a value is missing and this package is not at `packages/cdk-constructs`.
 */
export function resolveBundleRoots(
  props: Pick<TracedNodeFunctionProps, 'projectRoot' | 'depsLockFilePath'>,
): BundleRoots {
  const { projectRoot, depsLockFilePath } = props;
  if (projectRoot !== undefined && depsLockFilePath !== undefined) {
    return { projectRoot, depsLockFilePath };
  }
  const repositoryRoot = findRepositoryRoot();
  return {
    projectRoot: projectRoot ?? repositoryRoot,
    depsLockFilePath: depsLockFilePath ?? join(repositoryRoot, RUSH_LOCK_FILE),
  };
}

/** Quotes a value for a POSIX shell (single quotes, with each `'` written as `'\''`). */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", String.raw`'\''`)}'`;
}

/**
 * Makes the shell commands that add and remove a temporary `package.json` in the bundle root.
 *
 * CDK finds pnpm from `pnpm-lock.yaml` and runs `pnpm exec esbuild` in the bundle root. Rush has
 * no `package.json` in its root folder, and `pnpm exec` fails in a folder without one. So
 * `create` writes `{}` to `package.json` and the marker `BUNDLE_PACKAGE_JSON_MARKER`, and `remove`
 * deletes both. A `package.json` that is there without the marker is never changed or removed.
 *
 * The marker is written first. If a step fails between the two hooks (for example esbuild), the
 * file and the marker stay, and the next bundle removes them.
 *
 * @param inputDirectory - The bundle root.
 * @returns The command that adds the file, and the command that removes it.
 */
export function bundlePackageJsonCommands(inputDirectory: string): {
  readonly create: string;
  readonly remove: string;
} {
  const packageJson = shellQuote(join(inputDirectory, 'package.json'));
  const marker = shellQuote(join(inputDirectory, BUNDLE_PACKAGE_JSON_MARKER));
  return {
    create: `if [ ! -e ${packageJson} ]; then : > ${marker} && printf '{}\\n' > ${packageJson}; fi`,
    remove: `if [ -e ${marker} ]; then rm -f ${packageJson} ${marker}; fi`,
  };
}

/**
 * Makes the command hooks of the bundle. The `create` command of `bundlePackageJsonCommands` runs
 * first, before the `beforeBundling` commands of the caller. The `remove` command runs last, after
 * the `afterBundling` commands of the caller. The `beforeInstall` commands of the caller stay.
 *
 * @param caller - The command hooks of the caller, if any.
 * @returns The merged command hooks.
 */
export function bundlePackageJsonHooks(caller?: ICommandHooks): ICommandHooks {
  return {
    beforeBundling: (inputDirectory, outputDirectory) => [
      bundlePackageJsonCommands(inputDirectory).create,
      ...(caller?.beforeBundling(inputDirectory, outputDirectory) ?? []),
    ],
    beforeInstall: (inputDirectory, outputDirectory) =>
      caller?.beforeInstall(inputDirectory, outputDirectory) ?? [],
    afterBundling: (inputDirectory, outputDirectory) => [
      ...(caller?.afterBundling(inputDirectory, outputDirectory) ?? []),
      bundlePackageJsonCommands(inputDirectory).remove,
    ],
  };
}

/**
 * A Node.js Lambda function with tracing (see `TracedFunctionBase`). CDK bundles the code with
 * esbuild on this machine, as one ES module with source maps. It runs on Node.js 24 and arm64.
 * It sets `NODE_OPTIONS=--enable-source-maps`, so stack traces show the TypeScript lines. A caller
 * can set its own `NODE_OPTIONS` in `environment`.
 *
 * The bundle root defaults to the repo root folder and the lock file to the Rush lock file. Both
 * defaults assume that this package is at `packages/cdk-constructs` in a Rush repo. CDK
 * finds pnpm from the lock file and runs `pnpm exec esbuild` in the bundle root, which fails in a
 * folder without `package.json`. Rush has none in its root folder, so the bundle hooks add an
 * empty `package.json` before esbuild and remove it after. They never touch a `package.json` that
 * they did not make.
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
   * @throws When `projectRoot` or `depsLockFilePath` is missing and this package is not at
   *   `packages/cdk-constructs` in the repo.
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
      ...resolveBundleRoots(props),
      bundling: {
        banner: NODE_REQUIRE_BANNER,
        mainFields: ['module', 'main'],
        ...props.bundling,
        commandHooks: bundlePackageJsonHooks(props.bundling?.commandHooks),
        format: OutputFormat.ESM,
        sourceMap: true,
      },
    });
    this.completeSetup();
  }
}
