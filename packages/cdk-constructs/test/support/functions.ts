import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { App, Stack } from 'aws-cdk-lib';
import type { Construct } from 'constructs';

import { TracedNodeFunction } from '../../src/traced-node-function.js';
import type { TracedNodeFunctionProps } from '../../src/traced-node-function.js';

const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url));
const REPO_ROOT = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));

/** The paths of the fixture code. */
export const PATHS = {
  nodeEntry: join(FIXTURES, 'node-api', 'handler.ts'),
  nodeProjectRoot: REPO_ROOT,
  lockFile: join(REPO_ROOT, 'common', 'config', 'rush', 'pnpm-lock.yaml'),
} as const;

/** The context value that turns bundling off, so no esbuild or Docker run. */
const NO_BUNDLING = { 'aws:cdk:bundling-stacks': [] } as const;

/** Makes an app that does not bundle. */
export function newApp(): App {
  return new App({ context: NO_BUNDLING });
}

/** Makes a stack in an app that does not bundle. */
export function newStack(): Stack {
  return new Stack(newApp(), 'TestStack');
}

/** The kinds of traced function. */
export const KINDS = ['node'] as const;

/** One kind of traced function. */
export type Kind = (typeof KINDS)[number];

/** The props that all kinds share. */
export type CommonOverrides = Partial<
  Pick<
    TracedNodeFunctionProps,
    'serviceName' | 'env' | 'memorySize' | 'timeout' | 'environment' | 'logRetention'
  >
>;

/**
 * The kind-specific props of a Node.js function, with the fixture code. The bundle root and the
 * lock file use the defaults (the Rush root folder and the Rush lock file).
 */
export function nodeProps(overrides: CommonOverrides = {}): TracedNodeFunctionProps {
  return {
    serviceName: 'sample-api',
    env: 'local',
    entry: PATHS.nodeEntry,
    ...overrides,
  };
}

/** Creates a traced function of each kind, with the fixture code. */
const FACTORIES: Record<
  Kind,
  (scope: Construct, id: string, overrides: CommonOverrides) => TracedNodeFunction
> = {
  node: (scope, id, overrides) => new TracedNodeFunction(scope, id, nodeProps(overrides)),
};

/**
 * Creates a traced function of one kind, with the fixture code.
 *
 * @param kind - The kind of function.
 * @param scope - The parent construct.
 * @param overrides - Props that all kinds share, and the construct ID (`id`, default `Api`).
 * @returns The new construct.
 */
export function createFunction(
  kind: Kind,
  scope: Construct,
  { id = 'Api', ...overrides }: CommonOverrides & { readonly id?: string } = {},
): TracedNodeFunction {
  return FACTORIES[kind](scope, id, overrides);
}
