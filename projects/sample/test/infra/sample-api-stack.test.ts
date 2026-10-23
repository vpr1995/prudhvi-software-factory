import { App, Validations } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { AwsSolutionsChecks } from 'cdk-nag';
import { beforeAll, describe, expect, it } from 'vitest';

import { ADOT_COLLECTOR_LAYER_ARN, PLATFORM_ENVS } from '@vprprudhvi/shared-cdk-constructs';
import type { PlatformEnv } from '@vprprudhvi/shared-cdk-constructs';

import { loadSampleConfig } from '../../lib/config/config.js';
import { APIG4_REASON } from '../../lib/nag-acknowledgments/sample-api-stack.js';
import { SAMPLE_ROUTES, SampleApiStack } from '../../lib/sample-api-stack.js';

type Built = { readonly stack: SampleApiStack; readonly template: Template };

/** The time that the first build of each environment can take: it hashes the Python and Go code. */
const BUILD_TIMEOUT_MS = 60_000;

const builds = new Map<PlatformEnv, Built>();

/**
 * Creates the stack for one environment, once. The context turns bundling off, so no tool runs.
 * The tests only read the stack, so they share it.
 */
function build(env: PlatformEnv = 'dev'): Built {
  const known = builds.get(env);
  if (known !== undefined) {
    return known;
  }
  const app = new App({ context: { 'aws:cdk:bundling-stacks': [] } });
  const stack = new SampleApiStack(app, 'TestSampleApi', {
    config: loadSampleConfig(env),
    env: { region: 'us-east-1' },
  });
  const built = { stack, template: Template.fromStack(stack) };
  builds.set(env, built);
  return built;
}

beforeAll(() => {
  for (const env of PLATFORM_ENVS) {
    build(env);
  }
}, BUILD_TIMEOUT_MS);

/** Finds the resources of one type whose properties contain `properties` (deep, partial match). */
function findWith(template: Template, type: string, properties: Record<string, unknown>): string[] {
  return Object.keys(template.findResources(type, { Properties: Match.objectLike(properties) }));
}

/** Returns the properties of every resource of one type. */
function propertiesOf(template: Template, type: string): Record<string, unknown>[] {
  return Object.values(template.findResources(type)).map(
    (resource) => (resource as { Properties: Record<string, unknown> }).Properties,
  );
}

/** Returns the environment variables of every function in the template. */
function functionEnvironments(template: Template): Record<string, string>[] {
  return propertiesOf(template, 'AWS::Lambda::Function').map(
    (properties) => (properties['Environment'] as { Variables: Record<string, string> }).Variables,
  );
}

/** Returns the route keys of the routes with the given authorization type, sorted. */
function routeKeys(template: Template, authorizationType: string): unknown[] {
  return propertiesOf(template, 'AWS::ApiGatewayV2::Route')
    .filter((properties) => properties['AuthorizationType'] === authorizationType)
    .map((properties) => properties['RouteKey'])
    .sort();
}

describe('SampleApiStack functions', () => {
  it('has three arm64 functions with the runtime and handler of each part', () => {
    const { template } = build();

    const functions = propertiesOf(template, 'AWS::Lambda::Function').map(
      (properties) => `${String(properties['Runtime'])} ${String(properties['Handler'])}`,
    );
    expect(functions.sort()).toEqual([
      'nodejs24.x index.handler',
      'provided.al2023 bootstrap',
      'python3.14 src.sample_api.handler.lambda_handler',
    ]);
    expect(findWith(template, 'AWS::Lambda::Function', { Architectures: ['arm64'] })).toHaveLength(
      3,
    );
  });

  it('gives every function active tracing and the ADOT collector layer', () => {
    const { template } = build();

    expect(
      findWith(template, 'AWS::Lambda::Function', {
        TracingConfig: { Mode: 'Active' },
        Layers: [ADOT_COLLECTOR_LAYER_ARN],
      }),
    ).toHaveLength(3);
  });

  it.each([
    ['sample-api', 'SAMPLE_API_ENVIRONMENT'],
    ['sample-api-py', 'SAMPLE_API_PY_ENVIRONMENT'],
    ['sample-api-go', 'SAMPLE_API_GO_ENVIRONMENT'],
  ])('sets the service name and the environment of %s', (serviceName, variable) => {
    const { template } = build('staging');

    expect(
      findWith(template, 'AWS::Lambda::Function', {
        Environment: {
          Variables: { OTEL_SERVICE_NAME: serviceName, [variable]: 'staging' },
        },
      }),
    ).toHaveLength(1);
  });

  it.each([
    ['dev', '1.0'],
    ['staging', '1.0'],
    ['prod', '0.1'],
  ] as const)('samples %s traces at the ratio %s', (env, ratio) => {
    const ratios = functionEnvironments(build(env).template).map(
      (variables) => variables['OTEL_TRACES_SAMPLER_ARG'],
    );

    expect(ratios).toEqual([ratio, ratio, ratio]);
  });

  it('never sets the Lambda exec wrapper', () => {
    expect(JSON.stringify(build().template.toJSON())).not.toContain('AWS_LAMBDA_EXEC_WRAPPER');
  });
});

describe('SampleApiStack HTTP APIs', () => {
  it('has three HTTP APIs and no domain, record or certificate', () => {
    const { template } = build();
    const count = (type: string): number => Object.keys(template.findResources(type)).length;

    expect(count('AWS::ApiGatewayV2::Api')).toBe(3);
    expect(count('AWS::ApiGatewayV2::DomainName')).toBe(0);
    expect(count('AWS::Route53::RecordSet')).toBe(0);
    expect(count('AWS::CertificateManager::Certificate')).toBe(0);
  });

  it('has exactly the routes of SAMPLE_ROUTES on each API, and no $default or proxy route', () => {
    const { template } = build();
    const keys = propertiesOf(template, 'AWS::ApiGatewayV2::Route')
      .map((properties) => String(properties['RouteKey']))
      .sort();

    expect(SAMPLE_ROUTES.map((route) => `${route.method} ${route.path}`).sort()).toEqual([
      'GET /v1/health',
      'GET /v1/notes',
      'POST /v1/notes',
    ]);
    expect(keys).toEqual(
      Array.from({ length: 3 }, () => ['GET /v1/health', 'GET /v1/notes', 'POST /v1/notes'])
        .flat()
        .sort(),
    );
    expect(keys.filter((key) => key.includes('$default') || key.includes('proxy'))).toEqual([]);
  });

  it('has only the health route without a token, on each API', () => {
    const { template } = build();

    expect(routeKeys(template, 'NONE')).toEqual([
      'GET /v1/health',
      'GET /v1/health',
      'GET /v1/health',
    ]);
  });

  it('puts the notes routes behind the JWT authorizer, on each API', () => {
    const { template } = build();

    expect(routeKeys(template, 'JWT')).toEqual([
      'GET /v1/notes',
      'GET /v1/notes',
      'GET /v1/notes',
      'POST /v1/notes',
      'POST /v1/notes',
      'POST /v1/notes',
    ]);
    expect(Object.keys(template.findResources('AWS::ApiGatewayV2::Authorizer'))).toHaveLength(3);
  });

  it('checks the issuer of the platform pool and the audience of the project client', () => {
    const { template } = build();

    expect(
      findWith(template, 'AWS::ApiGatewayV2::Authorizer', {
        AuthorizerType: 'JWT',
        JwtConfiguration: {
          Audience: [{ Ref: Match.stringLikeRegexp('^UserPoolClient') }],
          Issuer: Match.anyValue(),
        },
      }),
    ).toHaveLength(3);
  });

  it('allows the dev web origin in CORS and no origin in staging or prod', () => {
    for (const properties of propertiesOf(build('dev').template, 'AWS::ApiGatewayV2::Api')) {
      expect(properties['CorsConfiguration']).toMatchObject({
        AllowOrigins: ['http://localhost:3000'],
      });
    }
    for (const env of ['staging', 'prod'] as const) {
      for (const properties of propertiesOf(build(env).template, 'AWS::ApiGatewayV2::Api')) {
        expect(properties).not.toHaveProperty('CorsConfiguration');
      }
    }
  });

  it('adds one output with the URL of each API, the sign-in domain and the client ID', () => {
    const { template } = build();

    expect(Object.keys(template.toJSON()['Outputs'] as object).sort()).toEqual([
      'GoApiUrl',
      'PythonApiUrl',
      'TypeScriptApiUrl',
      'UserPoolClientId',
      'UserPoolDomain',
    ]);
  });
});

describe('SampleApiStack app client', () => {
  it('makes one public client with the code grant and the config URLs', () => {
    const { template } = build();

    expect(
      findWith(template, 'AWS::Cognito::UserPoolClient', {
        GenerateSecret: false,
        AllowedOAuthFlows: ['code'],
        CallbackURLs: ['http://localhost:3000/auth/callback'],
        LogoutURLs: ['http://localhost:3000'],
        SupportedIdentityProviders: ['Google', 'COGNITO'],
      }),
    ).toHaveLength(1);
    expect(Object.keys(template.findResources('AWS::Cognito::UserPoolClient'))).toHaveLength(1);
  });

  it.each(PLATFORM_ENVS)('uses the callback URLs of the %s config', (env) => {
    const { template } = build(env);

    expect(
      findWith(template, 'AWS::Cognito::UserPoolClient', {
        CallbackURLs: [...loadSampleConfig(env).callbackUrls],
      }),
    ).toHaveLength(1);
  });

  it('imports the platform pool from SSM and creates no pool', () => {
    const { template } = build('prod');

    expect(Object.keys(template.findResources('AWS::Cognito::UserPool'))).toHaveLength(0);
    expect(Object.keys(template.toJSON()['Parameters'] as object).join(' ')).toContain(
      'platformprodcognitouserpoolarn',
    );
  });
});

describe('SampleApiStack cdk-nag', () => {
  // cdk-nag 3 is a validation plugin, so these tests call `validateScope` and read the report.
  // The stack acknowledges APIG4 on the public route of each API (the owner approved it for
  // `GET /v1/health` only) in `lib/nag-acknowledgments/sample-api-stack.ts`. The two IAM5
  // findings of each function come from `TracedFunctionBase`.

  /** Lists the violations as `rule id (severity)`. */
  function violations(stack: SampleApiStack): string[] {
    return new AwsSolutionsChecks()
      .validateScope(stack)
      .violations.map((violation) => `${violation.ruleName} (${violation.severity ?? 'unknown'})`);
  }

  /** Lists the acknowledged rule ids of one construct. The metadata key is `Annotation::<id>`. */
  function acknowledgedOf(construct: {
    readonly node: { readonly metadata: readonly { type: string; data?: unknown }[] };
  }): [string, string][] {
    return construct.node.metadata
      .filter((entry) => entry.type === Validations.ACKNOWLEDGED_RULES_METADATA_KEY)
      .flatMap((entry) => Object.entries(entry.data as Record<string, string>))
      .map(([id, reason]) => [id.replace(/^Annotation::/, ''), reason]);
  }

  it.each(PLATFORM_ENVS)('has zero AwsSolutions violations in %s', (env) => {
    expect(violations(build(env).stack)).toEqual([]);
  });

  it('lists only the three health routes as public routes', () => {
    const { stack } = build();
    const health = stack.apis.flatMap((api) => api.publicRoutes);

    expect(health.map((entry) => `${entry.method} ${entry.path}`)).toEqual([
      'GET /v1/health',
      'GET /v1/health',
      'GET /v1/health',
    ]);
  });

  it('acknowledges APIG4 on the public routes only, with the owner reason', () => {
    const { stack } = build();

    const acknowledged = stack.apis.flatMap((api) =>
      api.routes.flatMap((entry) =>
        acknowledgedOf(entry.route).map(([id, reason]) => ({
          route: `${entry.method} ${entry.path}`,
          id,
          reason,
        })),
      ),
    );

    expect(acknowledged.map(({ route, id }) => `${route} ${id}`)).toEqual([
      'GET /v1/health AwsSolutions-APIG4',
      'GET /v1/health AwsSolutions-APIG4',
      'GET /v1/health AwsSolutions-APIG4',
    ]);
    expect(APIG4_REASON).toBe('health check for uptime monitoring; returns no user data');
    for (const { reason } of acknowledged) {
      expect(reason).toBe(APIG4_REASON);
    }
  });

  it('acknowledges exactly three APIG4 and the IAM5 findings of the base, and nothing else', () => {
    const { stack } = build();

    const ids = stack.node
      .findAll()
      .flatMap((construct) => acknowledgedOf(construct).map(([id]) => id))
      .sort();

    // Per function (TracedFunctionBase): IAM5 for the X-Ray resource and IAM5 for the log streams.
    // Per API: APIG4 for the health route. Nothing else.
    expect(ids.filter((id) => id === 'AwsSolutions-APIG4')).toHaveLength(3);
    expect(ids.filter((id) => id === 'AwsSolutions-IAM5[Resource::*]')).toHaveLength(3);
    expect(
      ids.filter((id) => /^AwsSolutions-IAM5\[Resource::<.+\.Arn>:\*\]$/.test(id)),
    ).toHaveLength(3);
    expect(ids).toHaveLength(9);
  });
});
