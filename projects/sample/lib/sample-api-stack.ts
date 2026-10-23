import { resolve } from 'node:path';

import { CfnOutput, Stack } from 'aws-cdk-lib';
import type { StackProps } from 'aws-cdk-lib';
import { HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import type { IUserPool, IUserPoolClient } from 'aws-cdk-lib/aws-cognito';
import type { Construct } from 'constructs';

import {
  PYTHON_DEFAULT_ASSET_EXCLUDES,
  TracedGoFunction,
  TracedHttpApi,
  TracedNodeFunction,
  TracedPythonFunction,
  createProjectUserPoolClient,
  readPlatformUserPool,
} from '@vprprudhvi/shared-cdk-constructs';
import type { LambdaRouteProps, TracedFunctionBase } from '@vprprudhvi/shared-cdk-constructs';

import type { SampleConfig } from './config/sample-config.js';
import { acknowledgeSampleApiStack } from './nag-acknowledgments/sample-api-stack.js';
import { findProjectRoot } from './project-root.js';

/**
 * The routes of each API. All three APIs serve the same paths. `GET /v1/health` is the one public
 * route. The other routes need a token from the platform user pool, issued to the app client of
 * this project. Add a route here when you add it to `src/contracts` and to each API. There is no
 * `$default` route and no proxy route: a request to any other path stops at the gateway.
 */
export const SAMPLE_ROUTES: readonly Omit<LambdaRouteProps, 'fn'>[] = [
  { method: HttpMethod.GET, path: '/v1/health', public: true },
  { method: HttpMethod.GET, path: '/v1/notes' },
  { method: HttpMethod.POST, path: '/v1/notes' },
];

/** Settings for `SampleApiStack`. */
export type SampleApiStackProps = StackProps & {
  /** The settings of the environment. */
  readonly config: SampleConfig;
};

/** The three parts of the project. */
type PartName = 'TypeScript' | 'Python' | 'Go';

/**
 * The stack of the three sample APIs (TypeScript, Python, Go). Each API is one traced function
 * (`TracedNodeFunction`, `TracedPythonFunction`, `TracedGoFunction`) behind one `TracedHttpApi`
 * with the routes in `SAMPLE_ROUTES`. No domain exists yet, so each API has its `execute-api` URL.
 *
 * CDK bundles the code at synth: esbuild for TypeScript, `go build` for Go, and `uv` in Docker for
 * Python. Build the workspace packages first (`rush build`), because the TypeScript bundle reads
 * their `dist` output.
 */
export class SampleApiStack extends Stack {
  /** The app client of this project on the platform user pool. */
  public readonly userPoolClient: IUserPoolClient;
  /** The imported platform user pool. */
  public readonly userPool: IUserPool;
  /** The three functions, in the order TypeScript, Python, Go. */
  public readonly functions: readonly TracedFunctionBase[];
  /** The three HTTP APIs, in the same order. */
  public readonly apis: readonly TracedHttpApi[];

  /**
   * @param scope - The CDK app.
   * @param id - The stack ID.
   * @param props - The stack props and the environment config.
   */
  public constructor(scope: Construct, id: string, props: SampleApiStackProps) {
    const { config, ...stackProps } = props;
    super(scope, id, stackProps);

    const platform = readPlatformUserPool(this, config.env);
    this.userPool = platform.userPool;
    this.userPoolClient = createProjectUserPoolClient(this, 'UserPoolClient', {
      userPool: platform.userPool,
      callbackUrls: config.callbackUrls,
      logoutUrls: config.logoutUrls,
    });

    const projectRoot = findProjectRoot();
    const parts: readonly (readonly [PartName, TracedFunctionBase])[] = [
      ['TypeScript', this.createNodeFunction(projectRoot, config)],
      ['Python', this.createPythonFunction(projectRoot, config)],
      ['Go', this.createGoFunction(projectRoot, config)],
    ];
    this.functions = parts.map(([, target]) => target);
    this.apis = parts.map(([part, target]) => this.addApi(part, target, config));

    new CfnOutput(this, 'UserPoolDomain', {
      value: platform.domainName,
      description: 'The host name of the hosted sign-in domain. The web app signs in there.',
    });
    new CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'The ID of the app client of this project.',
    });
    acknowledgeSampleApiStack(this.apis);
  }

  /**
   * Creates the TypeScript function (`src/api/lambda.ts`).
   *
   * @param projectRoot - The project folder.
   * @param config - The settings of the environment.
   * @returns The function.
   */
  private createNodeFunction(projectRoot: string, config: SampleConfig): TracedNodeFunction {
    return new TracedNodeFunction(this, 'TypeScriptFunction', {
      serviceName: 'sample-api',
      env: config.env,
      entry: resolve(projectRoot, 'src/api/lambda.ts'),
      // `pnpm-lock.yaml` in the project folder is a link to the lock file of Rush. CDK runs esbuild
      // with `pnpm exec` in the folder of the bundle root, and Rush has no package at the repo root.
      depsLockFilePath: resolve(projectRoot, 'pnpm-lock.yaml'),
      projectRoot,
      environment: { SAMPLE_API_ENVIRONMENT: config.env },
    });
  }

  /**
   * Creates the Python function (`src/api-py`, handler `sample_api.handler.lambda_handler`).
   *
   * CDK installs the locked dependencies and copies the folder, but it does not install the
   * project package. The code is in `/var/task/src`, so `PYTHONPATH` makes `sample_api`
   * importable.
   *
   * @param projectRoot - The project folder.
   * @param config - The settings of the environment.
   * @returns The function.
   */
  private createPythonFunction(projectRoot: string, config: SampleConfig): TracedPythonFunction {
    return new TracedPythonFunction(this, 'PythonFunction', {
      serviceName: 'sample-api-py',
      env: config.env,
      entry: resolve(projectRoot, 'src/api-py'),
      index: 'src/sample_api/handler.py',
      handler: 'lambda_handler',
      bundling: {
        // The Lambda needs the code and the locked dependencies, not the tests and the tools.
        assetExcludes: [...PYTHON_DEFAULT_ASSET_EXCLUDES, 'tests', 'scripts'],
      },
      environment: { SAMPLE_API_PY_ENVIRONMENT: config.env, PYTHONPATH: '/var/task/src' },
    });
  }

  /**
   * Creates the Go function (`src/api-go/cmd/sample-api`).
   *
   * @param projectRoot - The project folder.
   * @param config - The settings of the environment.
   * @returns The function.
   */
  private createGoFunction(projectRoot: string, config: SampleConfig): TracedGoFunction {
    return new TracedGoFunction(this, 'GoFunction', {
      serviceName: 'sample-api-go',
      env: config.env,
      moduleDir: resolve(projectRoot, 'src/api-go'),
      entry: resolve(projectRoot, 'src/api-go/cmd/sample-api'),
      // Strip the symbol table and the debug data: the binary is smaller and starts faster.
      bundling: { goBuildFlags: ['-ldflags "-s -w"'] },
      environment: { SAMPLE_API_GO_ENVIRONMENT: config.env },
    });
  }

  /**
   * Adds the HTTP API of one function, with the routes of `SAMPLE_ROUTES`, and the output with
   * the API URL.
   *
   * @param part - The part of the project.
   * @param target - The function of the part.
   * @param config - The settings of the environment.
   * @returns The HTTP API.
   */
  private addApi(part: PartName, target: TracedFunctionBase, config: SampleConfig): TracedHttpApi {
    const api = new TracedHttpApi(this, `${part}HttpApi`, {
      userPool: this.userPool,
      userPoolClient: this.userPoolClient,
      ...(config.corsOrigins.length === 0 ? {} : { corsOrigins: config.corsOrigins }),
    });
    for (const route of SAMPLE_ROUTES) {
      api.addLambdaRoute({ ...route, fn: target });
    }
    new CfnOutput(this, `${part}ApiUrl`, {
      value: api.url,
      description: `The base URL of the ${part} API.`,
    });
    return api;
  }
}
