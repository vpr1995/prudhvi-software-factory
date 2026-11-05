import { resolve } from 'node:path';

import { CfnOutput, Stack } from 'aws-cdk-lib';
import type { StackProps } from 'aws-cdk-lib';
import { HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import type { IUserPool, IUserPoolClient } from 'aws-cdk-lib/aws-cognito';
import type { Construct } from 'constructs';

import {
  TracedHttpApi,
  TracedNodeFunction,
  createProjectUserPoolClient,
  readPlatformUserPool,
} from '@vprprudhvi/shared-cdk-constructs';
import type { LambdaRouteProps, TracedFunctionBase } from '@vprprudhvi/shared-cdk-constructs';

import type { SampleConfig } from './config/sample-config.js';
import { acknowledgeSampleApiStack } from './nag-acknowledgments/sample-api-stack.js';
import { findProjectRoot } from './project-root.js';

/**
 * The routes of the API. `GET /v1/health` is the one public route. The other routes need a token
 * from the platform user pool, issued to the app client of this project. Add a route here when you add it to `src/contracts` and to the API. There is no
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

/** The API parts of the project. The name is the prefix of the construct IDs. */
type PartName = 'TypeScript';

/**
 * The stack of the sample TypeScript API. The API is one traced function (`TracedNodeFunction`)
 * behind one `TracedHttpApi` with the routes in `SAMPLE_ROUTES`. No domain exists yet, so the API
 * has its `execute-api` URL.
 *
 * When `config.deployApis` is `false` (the `local` stack), the stack holds only the app client and
 * its outputs. The web app and the API then run on this machine.
 *
 * CDK bundles the code at synth with esbuild. Build the workspace packages first (`rush build`),
 * because the bundle reads their `dist` output.
 */
export class SampleApiStack extends Stack {
  /** The app client of this project on the platform user pool. */
  public readonly userPoolClient: IUserPoolClient;
  /** The imported platform user pool. */
  public readonly userPool: IUserPool;
  /** The functions, one for each API part. Empty when the APIs are off. */
  public readonly functions: readonly TracedFunctionBase[];
  /** The HTTP APIs, in the same order. Empty when the APIs are off. */
  public readonly apis: readonly TracedHttpApi[];

  /**
   * @param scope - The CDK app.
   * @param id - The stack ID.
   * @param props - The stack props and the environment config.
   */
  public constructor(scope: Construct, id: string, props: SampleApiStackProps) {
    const { config, ...stackProps } = props;
    super(scope, id, stackProps);

    const platform = readPlatformUserPool(this, config.platformEnv);
    this.userPool = platform.userPool;
    this.userPoolClient = createProjectUserPoolClient(this, 'UserPoolClient', {
      userPool: platform.userPool,
      callbackUrls: config.callbackUrls,
      logoutUrls: config.logoutUrls,
    });

    const parts = config.deployApis ? this.createFunctions(config) : [];
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
   * Creates the functions.
   *
   * @param config - The settings of the environment.
   * @returns The part name and the function of each part.
   */
  private createFunctions(
    config: SampleConfig,
  ): readonly (readonly [PartName, TracedFunctionBase])[] {
    const projectRoot = findProjectRoot();
    return [['TypeScript', this.createNodeFunction(projectRoot, config)]];
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
      environment: { SAMPLE_API_ENVIRONMENT: config.env },
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
