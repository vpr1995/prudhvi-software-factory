import { CfnOutput, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import type { CfnLogGroup } from 'aws-cdk-lib/aws-logs';
import { AwsSolutionsChecks } from 'cdk-nag';
import { describe, expect, it } from 'vitest';

import { ACCESS_LOG_FIELDS, TracedHttpApi } from '../src/http-api.js';
import type { TracedHttpApiProps } from '../src/http-api.js';
import {
  readPlatformCertificate,
  readPlatformDns,
  readPlatformUserPool,
} from '../src/platform-resources.js';
import { createProjectUserPoolClient } from '../src/project-user-pool-client.js';
import { TracedNodeFunction } from '../src/traced-node-function.js';

import { newApp, nodeProps } from './support/functions.js';

type Overrides = Partial<
  Omit<TracedHttpApiProps, 'fn' | 'userPool' | 'userPoolClient' | 'domain'>
> & {
  /** Add the custom domain `sample-api.<zone>`. Defaults to `true`. */
  readonly hasDomain?: boolean;
};

type Built = { readonly stack: Stack; readonly template: Template; readonly api: TracedHttpApi };

const HEALTH = { method: HttpMethod.GET, path: '/health' };

/** Creates a stack with the platform imports, one `TracedNodeFunction` and one `TracedHttpApi`. */
function build({ hasDomain = true, ...overrides }: Overrides = {}): Built {
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
    fn: tracedFunction,
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
  // Reference the hosted sign-in domain, so CloudFormation does not warn about an unused parameter.
  new CfnOutput(stack, 'SignInDomain', { value: pool.domainName });
  return { stack, template: Template.fromStack(stack), api };
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

describe('TracedHttpApi routes and authorizer', () => {
  it('has only the $default route when there are no public routes', () => {
    const { template } = build();

    expect(routeKeys(template)).toEqual(['$default']);
  });

  it('adds a route for each public route and the $default route', () => {
    const { template } = build({
      publicRoutes: [HEALTH, { method: HttpMethod.GET, path: '/version' }],
    });

    expect(routeKeys(template)).toEqual(['$default', 'GET /health', 'GET /version']);
  });

  it('puts the JWT authorizer on the $default route', () => {
    const { template } = build({ publicRoutes: [HEALTH] });
    const authorizerId = onlyId(template, 'AWS::ApiGatewayV2::Authorizer');

    expect(
      findWith(template, 'AWS::ApiGatewayV2::Route', {
        RouteKey: '$default',
        AuthorizationType: 'JWT',
        AuthorizerId: { Ref: authorizerId },
      }),
    ).toHaveLength(1);
  });

  it('puts no authorizer on a public route', () => {
    const { template } = build({ publicRoutes: [HEALTH] });
    const [publicRoute] = Object.values(
      template.findResources('AWS::ApiGatewayV2::Route', {
        Properties: { RouteKey: 'GET /health' },
      }),
    );

    expect(publicRoute?.['Properties']).toMatchObject({ AuthorizationType: 'NONE' });
    expect(publicRoute?.['Properties']).not.toHaveProperty('AuthorizerId');
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

  it('sends every route to the one Lambda with the HTTP API 2.0 payload', () => {
    const { template } = build({ publicRoutes: [HEALTH] });

    expect(
      findWith(template, 'AWS::ApiGatewayV2::Integration', {
        IntegrationType: 'AWS_PROXY',
        PayloadFormatVersion: '2.0',
      }),
    ).toHaveLength(1);
  });

  it('lets API Gateway invoke the function', () => {
    const { template } = build({ publicRoutes: [HEALTH] });

    expect(
      findWith(template, 'AWS::Lambda::Permission', {
        Action: 'lambda:InvokeFunction',
        Principal: 'apigateway.amazonaws.com',
      }),
    ).toHaveLength(2);
  });

  it('keeps one integration ID when the public routes change', () => {
    const first = Object.keys(build().template.findResources('AWS::ApiGatewayV2::Integration'));
    const second = Object.keys(
      build({ publicRoutes: [HEALTH] }).template.findResources('AWS::ApiGatewayV2::Integration'),
    );

    expect(second).toEqual(first);
  });

  it('gives unique construct IDs to routes that give the same ID text', () => {
    const { template } = build({
      publicRoutes: [
        { method: HttpMethod.GET, path: '/a-b' },
        { method: HttpMethod.GET, path: '/a/b' },
      ],
    });

    expect(routeKeys(template)).toEqual(['$default', 'GET /a-b', 'GET /a/b']);
  });

  it('rejects a public path without a leading slash', () => {
    expect(() => build({ publicRoutes: [{ method: HttpMethod.GET, path: 'health' }] })).toThrow(
      /must start with "\/"/,
    );
  });

  it('rejects a duplicate public route', () => {
    expect(() => build({ publicRoutes: [HEALTH, HEALTH] })).toThrow(/Duplicate public route/);
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
    const tracedFunction = new TracedNodeFunction(stack, 'Api', nodeProps());

    expect(
      () =>
        new TracedHttpApi(stack, 'Http', {
          fn: tracedFunction,
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
  // The only open finding is AwsSolutions-APIG4 on a public route. It has no suppression. The rule
  // wants an authorizer on every route. A public route such as `GET /health` has none on purpose.
  // Without public routes, the API has no violation.

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

  it('has zero AwsSolutions violations without public routes', () => {
    const { stack } = build();

    expect(violationNames(stack)).toEqual([]);
  });

  it('has zero AwsSolutions violations with CORS and a custom domain', () => {
    const { stack } = build({ corsOrigins: ['https://app.example.com'] });

    expect(violationNames(stack)).toEqual([]);
  });

  it('has only APIG4, on the public route, with one public route', () => {
    const { stack } = build({ publicRoutes: [HEALTH] });

    expect(violationNames(stack)).toEqual(['AwsSolutions-APIG4']);
    expect(violatingPaths(stack, 'AwsSolutions-APIG4')).toEqual([
      'TestStack/Http/PublicRouteGetHealth/Resource',
    ]);
  });
});
