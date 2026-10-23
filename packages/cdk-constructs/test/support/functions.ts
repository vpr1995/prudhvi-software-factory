import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { App, DockerImage, Stack } from 'aws-cdk-lib';
import type { Construct } from 'constructs';

import { TracedGoFunction } from '../../src/traced-go-function.js';
import type { TracedGoFunctionProps } from '../../src/traced-go-function.js';
import { TracedNodeFunction } from '../../src/traced-node-function.js';
import type { TracedNodeFunctionProps } from '../../src/traced-node-function.js';
import { TracedPythonFunction } from '../../src/traced-python-function.js';
import type { TracedPythonFunctionProps } from '../../src/traced-python-function.js';

const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url));
const REPO_ROOT = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));

/** The paths of the fixture code. */
export const PATHS = {
  nodeEntry: join(FIXTURES, 'node-api', 'handler.ts'),
  nodeProjectRoot: REPO_ROOT,
  lockFile: join(REPO_ROOT, 'common', 'config', 'rush', 'pnpm-lock.yaml'),
  goModule: join(FIXTURES, 'go-api'),
  goEntry: join(FIXTURES, 'go-api', 'cmd', 'api'),
  pythonEntry: join(FIXTURES, 'python-api'),
} as const;

/** The context value that turns bundling off, so no esbuild, `go`, `uv` or Docker run. */
export const NO_BUNDLING = { 'aws:cdk:bundling-stacks': [] } as const;

/** Makes an app that does not bundle. */
export function newApp(): App {
  return new App({ context: NO_BUNDLING });
}

/** Makes a stack in an app that does not bundle. */
export function newStack(): Stack {
  return new Stack(newApp(), 'TestStack');
}

/** The three kinds of traced function. */
export const KINDS = ['node', 'go', 'python'] as const;

/** One kind of traced function. */
export type Kind = (typeof KINDS)[number];

/** The props that all three kinds share. */
export type CommonOverrides = Partial<
  Pick<
    TracedNodeFunctionProps,
    'serviceName' | 'env' | 'memorySize' | 'timeout' | 'environment' | 'logRetention'
  >
>;

/** The kind-specific props of a Node.js function, with the fixture code. */
export function nodeProps(overrides: CommonOverrides = {}): TracedNodeFunctionProps {
  return {
    serviceName: 'sample-api',
    env: 'dev',
    entry: PATHS.nodeEntry,
    projectRoot: PATHS.nodeProjectRoot,
    depsLockFilePath: PATHS.lockFile,
    ...overrides,
  };
}

/**
 * The props of a Go function, with the fixture code. `TracedGoFunction` runs `go version` when it
 * is constructed, even when the stack does not bundle. When `go` is not installed, it builds a
 * Docker image. The dummy image stops that, so the tests need neither `go` nor Docker.
 */
export function goProps(overrides: CommonOverrides = {}): TracedGoFunctionProps {
  return {
    serviceName: 'sample-api-go',
    env: 'dev',
    moduleDir: PATHS.goModule,
    entry: PATHS.goEntry,
    bundling: { dockerImage: DockerImage.fromRegistry('dummy') },
    ...overrides,
  };
}

/** The props of a Python function, with the fixture code. */
export function pythonProps(overrides: CommonOverrides = {}): TracedPythonFunctionProps {
  return {
    serviceName: 'sample-api-py',
    env: 'dev',
    entry: PATHS.pythonEntry,
    index: 'index.py',
    ...overrides,
  };
}

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
): TracedNodeFunction | TracedGoFunction | TracedPythonFunction {
  switch (kind) {
    case 'node': {
      return new TracedNodeFunction(scope, id, nodeProps(overrides));
    }
    case 'go': {
      return new TracedGoFunction(scope, id, goProps(overrides));
    }
    case 'python': {
      return new TracedPythonFunction(scope, id, pythonProps(overrides));
    }
  }
}
