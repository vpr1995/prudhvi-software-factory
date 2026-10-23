import { CfnOutput, Stack, Validations } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import type { CfnLogGroup } from 'aws-cdk-lib/aws-logs';
import { AwsSolutionsChecks } from 'cdk-nag';
import { describe, expect, it } from 'vitest';

import { ACCESS_LOG_FIELDS, TracedHttpApi } from '../src/http-api.js';
import type { LambdaRouteProps, TracedHttpApiProps } from '../src/http-api.js';
import {
  readPlatformCertificate,
  readPlatformDns,
  readPlatformUserPool,
} from '../src/platform-resources.js';
import { createProjectUserPoolClient } from '../src/project-user-pool-client.js';
import { TracedNodeFunction } from '../src/traced-node-function.js';

import { newApp, nodeProps } from './support/functions.js';

type Overrides = Partial<Omit<TracedHttpApiProps, 'userPool' | 'userPoolClient' | 'domain'>> & {
  /** The routes to add. Defaults to `SAMPLE_ROUTES`. Use `[]` for none. */
  readonly routes?: readonly (Omit<LambdaRouteProps, 'fn'> & {
    /** Serve the route with a second function, `Worker`, and not with `Api`. */
    readonly worker?: boolean;
  })[];
  /** Add the custom domain `sample-api.<zone>`. Defaults to `true`. */
  readonly hasDomain?: boolean;
};

type Built = {
  readonly stack: Stack;
  readonly template: Template;
  readonly api: TracedHttpApi;
  readonly fn: TracedNodeFunction;
};

/** Two routes that need the JWT and one public route. */
const SAMPLE_ROUTES = [
  { method: HttpMethod.GET, path: '/v1/health', public: true },
  { method: HttpMethod.GET, path: '/v1/notes' },
  { method: HttpMethod.POST, path: '/v1/notes' },
] as const;

const SAMPLE_ROUTE_KEYS = ['GET /v1/health', 'GET /v1/notes', 'POST /v1/notes'];

/** Creates a stack with the platform imports, one `TracedNodeFunction` and one `TracedHttpApi`. */
function build({ hasDomain = true, routes = SAMPLE_ROUTES, ...overrides }: Overrides = {}): Built {
  const stack = new Stack(newApp(), 'TestStack');
  const pool = readPlatformUserPool(stack, 'dev');
  const tracedFunction = new TracedNodeFunction(stack, 'Api', nodeProps());
  // Without a domain the stack reads no DNS and no ACM parameter.
  const domain = {
    hostedZone: hasDomain ? readPlatformDns(stack, 'dev') : undefined,
    certificate: hasDomain ? readPlatformCertificate(stack, 'dev') : undefined,
    recordName: 'sample-api',
  };
  const api = new TracedHttpApi(stack, 'Http', {
    userPool: pool.userPool,
    userPoolClient: createProjectUserPoolClient(stack, 'WebClient', {
      userPool: pool.userPool,
      callbackUrls: ['https://app.example.com/callback'],
    }),
    ...(domain.hostedZone !== undefined && domain.certificate !== undefined
      ? { domain: { ...domain, hostedZone: domain.hostedZone, certificate: domain.certificate } }
      : {}),
    ...overrides,
  });
  const worker = routes.some((route) => route.worker === true)
    ? new TracedNodeFunction(stack, 'Worker', nodeProps({ serviceName: 'worker' }))
    : tracedFunction;
  for (const { worker: isWorker, ...route } of routes) {
    api.addLambdaRoute({ ...route, fn: isWorker === true ? worker : tracedFunction });
  }
  // Reference the hosted sign-in domain, so CloudFormation does not warn about an unused parameter.
  new CfnOutput(stack, 'SignInDomain', { value: pool.domainName });
  return { stack, template: Template.fromStack(stack), api, fn: tracedFunction };
}

/** Finds the resources of one type whose properties contain `properties` (deep, partial match). */
function findWith(template: Template, type: string, properties: Record<string, unknown>): string[] {
  return Object.keys(template.findResources(type, { Properties: Match.objectLike(properties) }));
}

/** Returns the properties of the first resource of one type in the template. */
function propertiesOf(template: Template, type: string): Record<string, unknown> {
  const [resource] = Object.values(template.findResources(type));
  const properties: unknown = resource?.['Properties'];
  return properties as Record<string, unknown>;
}

/** Lists the route keys of the template. */
function routeKeys(template: Template): string[] {
  return Object.values(template.findResources('AWS::ApiGatewayV2::Route'))
    .map((route) => String((route['Properties'] as Record<string, unknown>)['RouteKey']))
    .sort();
}

/** Finds the logical ID of the one resource of a type. */
function onlyId(template: Template, type: string): string {
  const ids = Object.keys(template.findResources(type));
  expect(ids).toHaveLength(1);
  return ids[0] ?? '';
}

/** Finds the properties of the one route resource with a route key. */
function routeResource(template: Template, routeKey: string): Record<string, unknown> {
  const routes = Object.values(
    template.findResources('AWS::ApiGatewayV2::Route', { Properties: { RouteKey: routeKey } }),
  );
  expect(routes).toHaveLength(1);
  return (routes[0]?.['Properties'] ?? {}) as Record<string, unknown>;
}

describe('TracedHttpApi routes and authorizer', () => {
  it('has no route until a route is added, and never a $default route', () => {
    const { template } = build({ routes: [] });

    expect(routeKeys(template)).toEqual([]);
  });

  it('has exactly the added route keys, and no $default or proxy route', () => {
    const { template } = build();
    const keys = routeKeys(template);

    expect(keys).toEqual(SAMPLE_ROUTE_KEYS);
    expect(keys).not.toContain('$default');
    expect(keys.filter((key) => key.includes('proxy'))).toEqual([]);
  });

  it('puts the JWT authorizer on each secured route', () => {
    const { template } = build();
    const authorizerId = onlyId(template, 'AWS::ApiGatewayV2::Authorizer');

    for (const key of ['GET /v1/notes', 'POST /v1/notes']) {
      expect(routeResource(template, key)).toMatchObject({
        AuthorizationType: 'JWT',
        AuthorizerId: { Ref: authorizerId },
      });
    }
  });

  it('puts no authorizer on the public route only', () => {
    const { template } = build();
    const publicRoute = routeResource(template, 'GET /v1/health');

    expect(publicRoute).toMatchObject({ AuthorizationType: 'NONE' });
    expect(publicRoute).not.toHaveProperty('AuthorizerId');
    expect(
      findWith(template, 'AWS::ApiGatewayV2::Route', { AuthorizationType: 'NONE' }),
    ).toHaveLength(1);
  });

  it('secures a route that does not say public, and a route with public false', () => {
    const { template } = build({
      routes: [
        { method: HttpMethod.GET, path: '/a' },
        { method: HttpMethod.GET, path: '/b', public: false },
      ],
    });

    expect(routeResource(template, 'GET /a')).toMatchObject({ AuthorizationType: 'JWT' });
    expect(routeResource(template, 'GET /b')).toMatchObject({ AuthorizationType: 'JWT' });
  });

  it('lists the routes and the public routes with their constructs', () => {
    const { api } = build();

    expect(api.routes.map((entry) => `${entry.method} ${entry.path}`)).toEqual(SAMPLE_ROUTE_KEYS);
    expect(api.publicRoutes).toHaveLength(1);
    expect(api.publicRoutes[0]).toMatchObject({
      method: 'GET',
      path: '/v1/health',
      isPublic: true,
    });
    expect(api.publicRoutes[0]?.route.node.id).toBe('RouteGetV1Health');
  });

  it('returns the route from addLambdaRoute', () => {
    const { api, fn } = build({ routes: [] });

    const entry = api.addLambdaRoute({ method: HttpMethod.DELETE, path: '/v1/notes/{id}', fn });

    expect(entry).toMatchObject({ method: 'DELETE', path: '/v1/notes/{id}', isPublic: false });
    expect(api.routes).toEqual([entry]);
  });

  it('keeps a path parameter in the route key', () => {
    const { template } = build({
      routes: [{ method: HttpMethod.DELETE, path: '/v1/notes/{id}' }],
    });

    expect(routeKeys(template)).toEqual(['DELETE /v1/notes/{id}']);
  });

  it('builds a JWT authorizer from the user pool and the app client', () => {
    const { template } = build();
    const clientId = onlyId(template, 'AWS::Cognito::UserPoolClient');
    const properties = propertiesOf(template, 'AWS::ApiGatewayV2::Authorizer');

    expect(properties).toMatchObject({
      AuthorizerType: 'JWT',
      IdentitySource: ['$request.header.Authorization'],
      JwtConfiguration: { Audience: [{ Ref: clientId }] },
    });
    expect(JSON.stringify(properties['JwtConfiguration'])).toContain('https://cognito-idp.');
  });

  it('shares one Lambda integration between the routes of one function', () => {
    const { template } = build();

    expect(
      findWith(template, 'AWS::ApiGatewayV2::Integration', {
        IntegrationType: 'AWS_PROXY',
        PayloadFormatVersion: '2.0',
      }),
    ).toHaveLength(1);
  });

  it('gives each function its own integration', () => {
    const { template } = build({
      routes: [
        { method: HttpMethod.GET, path: '/a' },
        { method: HttpMethod.GET, path: '/b', worker: true },
        { method: HttpMethod.GET, path: '/c', worker: true },
      ],
    });

    expect(Object.keys(template.findResources('AWS::ApiGatewayV2::Integration'))).toHaveLength(2);
  });

  it('lets API Gateway invoke the function from each route', () => {
    const { template } = build();

    expect(
      findWith(template, 'AWS::Lambda::Permission', {
        Action: 'lambda:InvokeFunction',
        Principal: 'apigateway.amazonaws.com',
      }),
    ).toHaveLength(3);
  });

  it('gives unique construct IDs to routes that give the same ID text', () => {
    const { template } = build({
      routes: [
        { method: HttpMethod.GET, path: '/a-b' },
        { method: HttpMethod.GET, path: '/a/b' },
      ],
    });

    expect(routeKeys(template)).toEqual(['GET /a-b', 'GET /a/b']);
  });

  it.each(['/{proxy+}', '/files/{path+}'])('rejects the greedy path %s', (path) => {
    expect(() => build({ routes: [{ method: HttpMethod.GET, path }] })).toThrow(/catch-all/);
  });

  it('rejects the $default route', () => {
    expect(() => build({ routes: [{ method: HttpMethod.GET, path: '$default' }] })).toThrow(
      /\$default route is a catch-all/,
    );
  });

  it('rejects a path without a leading slash', () => {
    expect(() => build({ routes: [{ method: HttpMethod.GET, path: 'health' }] })).toThrow(
      /must start with "\/"/,
    );
  });

  it('rejects a duplicate route, and allows the same path with another method', () => {
    expect(() =>
      build({
        routes: [
          { method: HttpMethod.GET, path: '/a' },
          { method: HttpMethod.GET, path: '/a' },
        ],
      }),
    ).toThrow('Duplicate route: GET /a');
    expect(
      routeKeys(
        build({
          routes: [
            { method: HttpMethod.GET, path: '/a' },
            { method: HttpMethod.POST, path: '/a' },
          ],
        }).template,
      ),
    ).toEqual(['GET /a', 'POST /a']);
  });
});

describe('TracedHttpApi default stage', () => {
  it('uses the $default stage with auto deploy', () => {
    const { template } = build();

    expect(
      findWith(template, 'AWS::ApiGatewayV2::Stage', { StageName: '$default', AutoDeploy: true }),
    ).toHaveLength(1);
  });

  it('throttles the stage with the defaults', () => {
    const { template } = build();

    expect(
      findWith(template, 'AWS::ApiGatewayV2::Stage', {
        DefaultRouteSettings: { ThrottlingRateLimit: 100, ThrottlingBurstLimit: 200 },
      }),
    ).toHaveLength(1);
  });

  it('takes the throttle limits from the props', () => {
    const { template } = build({ throttleRateLimit: 5, throttleBurstLimit: 10 });

    expect(
      findWith(template, 'AWS::ApiGatewayV2::Stage', {
        DefaultRouteSettings: { ThrottlingRateLimit: 5, ThrottlingBurstLimit: 10 },
      }),
    ).toHaveLength(1);
  });

  it('writes JSON access logs with the request ID to its own log group', () => {
    const { template, stack, api } = build();
    const groupId = stack.getLogicalId(api.accessLogGroup.node.defaultChild as CfnLogGroup);
    const settings = propertiesOf(template, 'AWS::ApiGatewayV2::Stage')['AccessLogSettings'] as {
      DestinationArn: unknown;
      Format: string;
    };
    const format = JSON.parse(settings.Format) as Record<string, string>;

    expect(settings.DestinationArn).toEqual({ 'Fn::GetAtt': [groupId, 'Arn'] });
    expect(format).toEqual(ACCESS_LOG_FIELDS);
    expect(format['requestId']).toBe('$context.requestId');
    expect(format['integrationRequestId']).toBe('$context.integration.requestId');
  });

  it('logs no request header, because an HTTP API cannot', () => {
    expect(Object.values(ACCESS_LOG_FIELDS).filter((value) => /header/i.test(value))).toEqual([]);
  });

  it('keeps access logs one month by default and keeps the log group', () => {
    const { template, stack, api } = build();
    const groupId = stack.getLogicalId(api.accessLogGroup.node.defaultChild as CfnLogGroup);
    const group = template.findResources('AWS::Logs::LogGroup')[groupId];

    expect(group).toMatchObject({
      Properties: { RetentionInDays: 30 },
      DeletionPolicy: 'Retain',
    });
  });

  it('takes the access log retention from the props', () => {
    const { template } = build({ accessLogRetention: RetentionDays.ONE_WEEK });

    expect(findWith(template, 'AWS::Logs::LogGroup', { RetentionInDays: 7 })).toHaveLength(1);
  });

  it('sets no stage tracing, because an HTTP API has no X-Ray support', () => {
    const { template } = build();

    expect(propertiesOf(template, 'AWS::ApiGatewayV2::Stage')).not.toHaveProperty('TracingEnabled');
  });
});

describe('TracedHttpApi CORS', () => {
  it('sends no CORS settings without corsOrigins', () => {
    const { template } = build();

    expect(propertiesOf(template, 'AWS::ApiGatewayV2::Api')).not.toHaveProperty(
      'CorsConfiguration',
    );
  });

  it('allows traceparent and tracestate and exposes traceparent with corsOrigins', () => {
    const { template } = build({ corsOrigins: ['https://app.example.com'] });
    const cors = propertiesOf(template, 'AWS::ApiGatewayV2::Api')['CorsConfiguration'] as Record<
      string,
      unknown
    >;

    expect(cors['AllowOrigins']).toEqual(['https://app.example.com']);
    expect(cors['AllowHeaders']).toEqual(
      expect.arrayContaining(['authorization', 'content-type', 'traceparent', 'tracestate']),
    );
    expect(cors['ExposeHeaders']).toEqual(['traceparent']);
    expect(cors).not.toHaveProperty('AllowCredentials');
  });

  it('rejects a wildcard origin', () => {
    expect(() => build({ corsOrigins: ['*'] })).toThrow(/"\*" is not allowed/);
  });
});

describe('TracedHttpApi custom domain', () => {
  it('creates no domain, mapping or record without domain', () => {
    const { template, api } = build({ hasDomain: false });

    expect(template.findResources('AWS::ApiGatewayV2::DomainName')).toEqual({});
    expect(template.findResources('AWS::ApiGatewayV2::ApiMapping')).toEqual({});
    expect(findWith(template, 'AWS::Route53::RecordSet', { Type: 'A' })).toEqual([]);
    expect(findWith(template, 'AWS::Route53::RecordSet', { Type: 'AAAA' })).toEqual([]);
    expect(api.url).toContain('execute-api');
  });

  it('creates a regional TLS 1.2 domain name with the wildcard certificate', () => {
    const { template } = build();
    const certificateParameter = Object.keys(
      template.findParameters('*', { Default: '/platform/dev/acm/wildcard-certificate-arn' }),
    );

    expect(
      findWith(template, 'AWS::ApiGatewayV2::DomainName', {
        DomainNameConfigurations: [
          {
            CertificateArn: { Ref: certificateParameter[0] },
            EndpointType: 'REGIONAL',
            SecurityPolicy: 'TLS_1_2',
          },
        ],
      }),
    ).toHaveLength(1);
  });

  it('names the domain from the record name and the zone name', () => {
    const { template } = build();
    const zoneNameParameter = Object.keys(
      template.findParameters('*', { Default: '/platform/dev/dns/zone-name' }),
    );

    expect(propertiesOf(template, 'AWS::ApiGatewayV2::DomainName')['DomainName']).toEqual({
      'Fn::Join': ['', ['sample-api.', { Ref: zoneNameParameter[0] }]],
    });
  });

  it('maps the domain to the $default stage', () => {
    const { template } = build();
    const domainId = onlyId(template, 'AWS::ApiGatewayV2::DomainName');

    expect(
      findWith(template, 'AWS::ApiGatewayV2::ApiMapping', {
        DomainName: { Ref: domainId },
        Stage: '$default',
      }),
    ).toHaveLength(1);
  });

  it.each(['A', 'AAAA'])('adds one %s alias record in the imported zone', (type) => {
    const { template } = build();
    const domainId = onlyId(template, 'AWS::ApiGatewayV2::DomainName');
    const zoneIdParameter = Object.keys(
      template.findParameters('*', { Default: '/platform/dev/dns/hosted-zone-id' }),
    );

    expect(
      findWith(template, 'AWS::Route53::RecordSet', {
        Type: type,
        HostedZoneId: { Ref: zoneIdParameter[0] },
        AliasTarget: {
          DNSName: { 'Fn::GetAtt': [domainId, 'RegionalDomainName'] },
          HostedZoneId: { 'Fn::GetAtt': [domainId, 'RegionalHostedZoneId'] },
        },
      }),
    ).toHaveLength(1);
  });

  it('gives the custom domain URL', () => {
    const { stack, template, api } = build();

    expect(stack.resolve(api.url)).toEqual({
      'Fn::Join': ['', ['https://', { Ref: onlyId(template, 'AWS::ApiGatewayV2::DomainName') }]],
    });
    expect(api.url).not.toContain('execute-api');
  });

  it.each(['', 'a.b', 'A', '-a', 'a_b'])('rejects the record name "%s"', (recordName) => {
    const stack = new Stack(newApp(), 'BadStack');
    const pool = readPlatformUserPool(stack, 'dev');
    expect(
      () =>
        new TracedHttpApi(stack, 'Http', {
          userPool: pool.userPool,
          userPoolClient: createProjectUserPoolClient(stack, 'WebClient', {
            userPool: pool.userPool,
            callbackUrls: ['https://app.example.com/callback'],
          }),
          domain: {
            hostedZone: readPlatformDns(stack, 'dev'),
            certificate: readPlatformCertificate(stack, 'dev'),
            recordName,
          },
        }),
    ).toThrow(/one DNS label/);
  });
});

describe('TracedHttpApi cdk-nag', () => {
  // cdk-nag 3 is a validation plugin, so these tests call `validateScope` and read the report.
  // The only open finding is AwsSolutions-APIG4 on a public route. The rule wants an authorizer on
  // every route, and a public route such as `GET /v1/health` has none on purpose. The construct
  // acknowledges nothing. The project acknowledges it on `api.publicRoutes`, and so does a test.

  /** Lists the rule names of all violations. */
  function violationNames(stack: Stack): string[] {
    return new AwsSolutionsChecks()
      .validateScope(stack)
      .violations.map((violation) => violation.ruleName);
  }

  /** Lists the construct paths of the violating resources for one rule. */
  function violatingPaths(stack: Stack, ruleName: string): string[] {
    return new AwsSolutionsChecks()
      .validateScope(stack)
      .violations.filter((violation) => violation.ruleName === ruleName)
      .flatMap((violation) =>
        violation.violatingResources.map((resource) => resource.constructPath ?? ''),
      );
  }

  it('has zero AwsSolutions violations when every route is secured', () => {
    const { stack } = build({
      routes: [
        { method: HttpMethod.GET, path: '/v1/notes' },
        { method: HttpMethod.POST, path: '/v1/notes' },
      ],
    });

    expect(violationNames(stack)).toEqual([]);
  });

  it('has zero AwsSolutions violations with CORS, a custom domain and no routes', () => {
    const { stack } = build({ routes: [], corsOrigins: ['https://app.example.com'] });

    expect(violationNames(stack)).toEqual([]);
  });

  it('has only APIG4, on the public route', () => {
    const { stack } = build();

    expect(violationNames(stack)).toEqual(['AwsSolutions-APIG4']);
    expect(violatingPaths(stack, 'AwsSolutions-APIG4')).toEqual([
      'TestStack/Http/RouteGetV1Health/Resource',
    ]);
  });

  it('has zero violations when the project acknowledges APIG4 on the public routes', () => {
    const { stack, api } = build({ corsOrigins: ['https://app.example.com'] });
    for (const entry of api.publicRoutes) {
      Validations.of(entry.route).acknowledge({
        id: 'AwsSolutions-APIG4',
        reason: 'The health route is public on purpose. Owner approved.',
      });
    }

    expect(violationNames(stack)).toEqual([]);
  });
});
