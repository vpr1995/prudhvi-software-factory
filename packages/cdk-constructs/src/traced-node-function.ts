import { createRequire } from 'node:module';
import { delimiter, dirname, join, resolve } from 'node:path';

import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import type { BundlingOptions, ICommandHooks } from 'aws-cdk-lib/aws-lambda-nodejs';
import type { Construct } from 'constructs';

import { inheritedPath } from './config.js';
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
   * clean-up step runs last in `afterBundling`. For a local bundle, `environment` gets the folder
   * of the esbuild of the project first in `PATH` (see `esbuildBundlingEnvironment`).
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

/**
 * A file of the aws-cdk-lib `aws-lambda-nodejs` module. CDK finds esbuild with `require` from its
 * own folder, so Node resolves `esbuild` from here the same way.
 */
export const CDK_NODEJS_MODULE = createRequire(import.meta.url).resolve(
  'aws-cdk-lib/aws-lambda-nodejs',
);

/** The `esbuild` command of the esbuild package (the `bin` entry of its `package.json`). */
export const ESBUILD_COMMAND = 'esbuild/bin/esbuild';

/**
 * Resolves a module request from a file with Node module resolution. It reads no file with a
 * computed path.
 *
 * @param fromFile - The file to resolve from.
 * @param request - The module request, for example `esbuild/package.json`.
 * @returns The absolute path of the module, or `undefined` when it does not resolve.
 */
export function resolveFrom(fromFile: string, request: string): string | undefined {
  try {
    return createRequire(resolve(fromFile)).resolve(request);
  } catch {
    return undefined;
  }
}

/**
 * Makes the environment of local bundling, so that each bundle runs the esbuild of the project.
 *
 * CDK runs `pnpm exec esbuild` (or `esbuild`) in the bundle root, the repo root folder. It has no
 * `node_modules`, so the command comes from `PATH`, and a global esbuild of another version can
 * run. This puts the folder of the esbuild that resolves from `entry` first in `PATH`. The other
 * keys of `environment` stay. The rest of `PATH` is the `PATH` of `environment`, or else the
 * `PATH` of this process. An empty `PATH` counts as unset.
 *
 * CDK bundles in Docker when it does not find esbuild with `require` from `cdkModule` (or on
 * `PATH`), and it gives the same environment to the container. A `PATH` of this machine breaks
 * the container, so this function fails instead.
 *
 * @param entry - The handler file.
 * @param environment - The bundling environment of the caller.
 * @param cdkModule - The file that CDK finds esbuild from. Defaults to `CDK_NODEJS_MODULE`.
 * @returns The bundling environment with the new `PATH`.
 * @throws When no esbuild resolves from `entry` or from `cdkModule`.
 */
export function esbuildBundlingEnvironment(
  entry: string,
  environment: Readonly<Record<string, string>> = {},
  cdkModule: string = CDK_NODEJS_MODULE,
): Record<string, string> {
  const command = resolveFrom(entry, ESBUILD_COMMAND);
  if (command === undefined) {
    throw new Error(
      `The esbuild command does not resolve from the entry ${entry}. Add esbuild to the ` +
        'devDependencies of the project that holds the entry.',
    );
  }
  // The same request as the esbuild check of CDK (`require('esbuild/package.json')`).
  if (resolveFrom(cdkModule, 'esbuild/package.json') === undefined) {
    throw new Error(
      `aws-cdk-lib cannot resolve esbuild from ${cdkModule}, so CDK would bundle in Docker. ` +
        'Install esbuild where aws-cdk-lib can resolve it, or set forceDockerBundling.',
    );
  }
  const binFolder = dirname(command);
  const rest = inheritedPath(environment) ?? inheritedPath();
  return {
    ...environment,
    PATH: rest === undefined ? binFolder : `${binFolder}${delimiter}${rest}`,
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
 * Each bundle runs the esbuild that Node resolves from `entry`, whatever the `PATH` of the
 * caller is (see `esbuildBundlingEnvironment`). The construct fails when no esbuild resolves from
 * `entry`, so add esbuild to the devDependencies of the project. With `forceDockerBundling` the
 * bundle runs in Docker, and the environment of the caller stays as it is.
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
   * @throws When the bundle is local and no esbuild resolves from `entry` (see
   *   `esbuildBundlingEnvironment`).
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
        // Docker gets the environment of the caller as it is. A local bundle gets the esbuild PATH.
        ...(props.bundling?.forceDockerBundling === true
          ? {}
          : { environment: esbuildBundlingEnvironment(props.entry, props.bundling?.environment) }),
        commandHooks: bundlePackageJsonHooks(props.bundling?.commandHooks),
        format: OutputFormat.ESM,
        sourceMap: true,
      },
    });
    this.completeSetup();
  }
}
