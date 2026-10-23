import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { AccessLogFormat } from 'aws-cdk-lib/aws-apigateway';
import {
  CorsHttpMethod,
  DomainName,
  EndpointType,
  HttpApi,
  HttpRoute,
  HttpRouteKey,
  HttpStage,
  LogGroupLogDestination,
  SecurityPolicy,
} from 'aws-cdk-lib/aws-apigatewayv2';
import type { CorsPreflightOptions, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpUserPoolAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import type { ICertificate } from 'aws-cdk-lib/aws-certificatemanager';
import type { IUserPool, IUserPoolClient } from 'aws-cdk-lib/aws-cognito';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import type { ILogGroup } from 'aws-cdk-lib/aws-logs';
import { AaaaRecord, ARecord, RecordTarget } from 'aws-cdk-lib/aws-route53';
import type { IHostedZone } from 'aws-cdk-lib/aws-route53';
import { ApiGatewayv2DomainProperties } from 'aws-cdk-lib/aws-route53-targets';
import { Construct } from 'constructs';

import type { TracedFunction } from './traced-function.js';

/** A route that needs no sign-in, for example `GET /health`. */
export type PublicRoute = {
  /** The HTTP method. */
  readonly method: HttpMethod;
  /** The path, starting with `/`. */
  readonly path: string;
};

/** A custom domain for the API, in the imported platform zone. */
export type HttpApiDomain = {
  /** The imported hosted zone. */
  readonly hostedZone: IHostedZone;
  /** The wildcard certificate of the zone (`us-east-1`). */
  readonly certificate: ICertificate;
  /** One DNS label under the zone, for example `sample-api`. The wildcard certificate covers one label. */
  readonly recordName: string;
};

/** Settings for `TracedHttpApi`. */
export type TracedHttpApiProps = {
  /** The Lambda that serves every route. */
  readonly fn: TracedFunction;
  /** The user pool that issues the tokens. Its ID gives the JWT issuer. */
  readonly userPool: IUserPool;
  /** The app client of this project. It gives the JWT audience. */
  readonly userPoolClient: IUserPoolClient;
  /** Routes without the JWT authorizer. Defaults to none. */
  readonly publicRoutes?: readonly PublicRoute[];
  /** A custom domain with Route53 alias records. Defaults to none. */
  readonly domain?: HttpApiDomain;
  /** Browser origins for CORS. Without it the API sends no CORS headers. `*` is not allowed. */
  readonly corsOrigins?: readonly string[];
  /** Steady request rate for the default stage, in requests per second. Defaults to 100. */
  readonly throttleRateLimit?: number;
  /** Burst limit for the default stage. Defaults to 200. */
  readonly throttleBurstLimit?: number;
  /** How long the access log group keeps logs. Defaults to one month. */
  readonly accessLogRetention?: RetentionDays;
};

const DEFAULT_RATE_LIMIT = 100;
const DEFAULT_BURST_LIMIT = 200;
const CORS_MAX_AGE_HOURS = 24;
const DNS_LABEL_CHARS = /^[a-z0-9-]+$/;

/**
 * The CORS request headers. `traceparent` and `tracestate` let the browser continue a trace.
 */
export const CORS_ALLOW_HEADERS = ['authorization', 'content-type', 'traceparent', 'tracestate'];

/** The CORS response headers that the browser can read. */
export const CORS_EXPOSE_HEADERS = ['traceparent'];

/**
 * The access log fields. An HTTP API cannot log request headers, so `traceparent` is not here.
 * `integrationRequestId` is the Lambda request ID. Use it to find the function log lines.
 */
export const ACCESS_LOG_FIELDS = {
  requestId: '$context.requestId',
  extendedRequestId: '$context.extendedRequestId',
  integrationRequestId: '$context.integration.requestId',
  requestTime: '$context.requestTime',
  httpMethod: '$context.httpMethod',
  routeKey: '$context.routeKey',
  path: '$context.path',
  status: '$context.status',
  protocol: '$context.protocol',
  responseLength: '$context.responseLength',
  responseLatency: '$context.responseLatency',
  integrationLatency: '$context.integrationLatency',
  integrationStatus: '$context.integrationStatus',
  sourceIp: '$context.identity.sourceIp',
  userAgent: '$context.identity.userAgent',
  domainName: '$context.domainName',
  errorMessage: '$context.error.message',
  authorizerError: '$context.authorizer.error',
} as const;

/**
 * Checks that a text is one DNS label: lower case letters, digits and "-", no "-" at the ends.
 *
 * @param label - The text to check.
 * @returns `true` for a valid label.
 */
function isDnsLabel(label: string): boolean {
  return DNS_LABEL_CHARS.test(label) && !label.startsWith('-') && !label.endsWith('-');
}

/**
 * Checks the props that CDK cannot check, and throws a clear error.
 *
 * @param props - The props of the construct.
 */
function validateProps(props: TracedHttpApiProps): void {
  const seen = new Set<string>();
  for (const route of props.publicRoutes ?? []) {
    if (!route.path.startsWith('/')) {
      throw new Error(`A public route path must start with "/": ${route.path}`);
    }
    const key = `${route.method} ${route.path}`;
    if (seen.has(key)) {
      throw new Error(`Duplicate public route: ${key}`);
    }
    seen.add(key);
  }
  if (props.corsOrigins?.includes('*') === true) {
    throw new Error('corsOrigins must list the origins. "*" is not allowed.');
  }
  if (props.domain !== undefined && !isDnsLabel(props.domain.recordName)) {
    throw new Error(
      `domain.recordName must be one DNS label (lower case letters, digits, "-"): ${props.domain.recordName}`,
    );
  }
}

/**
 * The CORS settings for a list of origins.
 *
 * @param origins - The allowed browser origins.
 * @returns The preflight options. They allow `traceparent` and `tracestate` and expose `traceparent`.
 */
function buildCors(origins: readonly string[]): CorsPreflightOptions {
  return {
    allowOrigins: [...origins],
    allowMethods: [CorsHttpMethod.ANY],
    allowHeaders: CORS_ALLOW_HEADERS,
    exposeHeaders: CORS_EXPOSE_HEADERS,
    maxAge: Duration.hours(CORS_MAX_AGE_HOURS),
  };
}

/**
 * An API Gateway HTTP API in front of one `TracedFunction`.
 *
 * - Public routes (`publicRoutes`) have no authorizer. Every other route goes to the `$default`
 *   route, which uses the JWT authorizer of the Cognito user pool.
 * - The `$default` stage has JSON access logs in its own log group, and throttling.
 * - The stage has no tracing. An HTTP API has no X-Ray support. Lambda active tracing starts the
 *   segment.
 * - With `domain`, it adds a custom domain, an API mapping, and alias A and AAAA records.
 */
export class TracedHttpApi extends Construct {
  /** The HTTP API. */
  public readonly api: HttpApi;
  /** The `$default` stage. */
  public readonly stage: HttpStage;
  /** The access log group. */
  public readonly accessLogGroup: ILogGroup;
  /** The base URL of the API: the custom domain when set, else the `execute-api` URL. */
  public readonly url: string;

  /**
   * @param scope - The parent construct.
   * @param id - The construct ID, in PascalCase.
   * @param props - The API settings.
   */
  public constructor(scope: Construct, id: string, props: TracedHttpApiProps) {
    super(scope, id);
    validateProps(props);

    this.api = new HttpApi(this, 'Api', {
      createDefaultStage: false,
      ...(props.corsOrigins === undefined ? {} : { corsPreflight: buildCors(props.corsOrigins) }),
    });

    this.accessLogGroup = new LogGroup(this, 'AccessLogGroup', {
      retention: props.accessLogRetention ?? RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const domainName =
      props.domain === undefined
        ? undefined
        : new DomainName(this, 'DomainName', {
            domainName: `${props.domain.recordName}.${props.domain.hostedZone.zoneName}`,
            certificate: props.domain.certificate,
            endpointType: EndpointType.REGIONAL,
            securityPolicy: SecurityPolicy.TLS_1_2,
          });

    this.stage = new HttpStage(this, 'DefaultStage', {
      httpApi: this.api,
      autoDeploy: true,
      throttle: {
        rateLimit: props.throttleRateLimit ?? DEFAULT_RATE_LIMIT,
        burstLimit: props.throttleBurstLimit ?? DEFAULT_BURST_LIMIT,
      },
      accessLogSettings: {
        destination: new LogGroupLogDestination(this.accessLogGroup),
        format: AccessLogFormat.custom(JSON.stringify(ACCESS_LOG_FIELDS)),
      },
      ...(domainName === undefined ? {} : { domainMapping: { domainName } }),
    });

    this.addRoutes(props);

    if (props.domain !== undefined && domainName !== undefined) {
      this.addAliasRecords(props.domain, domainName);
    }
    this.url = props.domain === undefined ? this.stage.url : `https://${domainName?.name ?? ''}`;
  }

  /**
   * Adds the public routes and the `$default` route.
   *
   * @param props - The props of the construct.
   */
  private addRoutes(props: TracedHttpApiProps): void {
    // The `$default` route comes first, so the shared integration is a child of it. Its ID then
    // does not change when someone edits `publicRoutes`.
    const integration = new HttpLambdaIntegration('LambdaIntegration', props.fn.function);
    const authorizer = new HttpUserPoolAuthorizer('UserPoolAuthorizer', props.userPool, {
      userPoolClients: [props.userPoolClient],
    });

    new HttpRoute(this, 'DefaultRoute', {
      httpApi: this.api,
      routeKey: HttpRouteKey.DEFAULT,
      integration,
      authorizer,
    });

    const usedIds = new Set<string>();
    for (const route of props.publicRoutes ?? []) {
      const id = uniqueId(`PublicRoute${routeIdSuffix(route)}`, usedIds);
      new HttpRoute(this, id, {
        httpApi: this.api,
        routeKey: HttpRouteKey.with(route.path, route.method),
        integration,
      });
    }
  }

  /**
   * Adds the A and AAAA alias records that point the custom domain at the API.
   *
   * @param domain - The domain settings.
   * @param domainName - The API Gateway domain name.
   */
  private addAliasRecords(domain: HttpApiDomain, domainName: DomainName): void {
    const target = RecordTarget.fromAlias(
      new ApiGatewayv2DomainProperties(
        domainName.regionalDomainName,
        domainName.regionalHostedZoneId,
      ),
    );
    new ARecord(this, 'AliasRecord', {
      zone: domain.hostedZone,
      recordName: domain.recordName,
      target,
    });
    new AaaaRecord(this, 'AliasRecordIpv6', {
      zone: domain.hostedZone,
      recordName: domain.recordName,
      target,
    });
  }
}

/**
 * Builds a PascalCase construct ID part from a route, for example `GetHealth`.
 *
 * @param route - A public route.
 * @returns The ID part. It has only letters and digits.
 */
function routeIdSuffix(route: PublicRoute): string {
  const words = `${route.method.toLowerCase()}-${route.path}`.split(/[^a-z0-9]+/i).filter(Boolean);
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join('');
}

/**
 * Makes a construct ID unique in a set. `GET /a-b` and `GET /a/b` give the same suffix, so the
 * second one gets a number.
 *
 * @param base - The wanted ID.
 * @param used - The IDs in use. The function adds the result to it.
 * @returns `base`, or `base` with a number.
 */
function uniqueId(base: string, used: Set<string>): string {
  let candidate = base;
  for (let count = 2; used.has(candidate); count += 1) {
    candidate = `${base}${String(count)}`;
  }
  used.add(candidate);
  return candidate;
}
