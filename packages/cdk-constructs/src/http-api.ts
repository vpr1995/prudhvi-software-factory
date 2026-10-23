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

import type { TracedFunctionBase } from './traced-function-base.js';

/** Settings for one route of `TracedHttpApi`. See `TracedHttpApi.addLambdaRoute`. */
export type LambdaRouteProps = {
  /** The HTTP method. */
  readonly method: HttpMethod;
  /**
   * The path, starting with `/`, for example `/v1/notes/{id}`. A greedy parameter such as
   * `{proxy+}` is not allowed.
   */
  readonly path: string;
  /** The traced function that serves the route. */
  readonly fn: TracedFunctionBase;
  /** `true` for a route that needs no sign-in, for example `GET /v1/health`. Defaults to `false`. */
  readonly public?: boolean;
};

/** A route of `TracedHttpApi` with its construct. */
export type TracedHttpRoute = {
  /** The HTTP method. */
  readonly method: HttpMethod;
  /** The path. */
  readonly path: string;
  /** `true` when the route has no authorizer. */
  readonly isPublic: boolean;
  /** The route construct. Use it to acknowledge a cdk-nag finding on this route. */
  readonly route: HttpRoute;
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
  /** The user pool that issues the tokens. Its ID gives the JWT issuer. */
  readonly userPool: IUserPool;
  /** The app client of this project. It gives the JWT audience. */
  readonly userPoolClient: IUserPoolClient;
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
 * Checks the path of a route. An HTTP API with a catch-all route sends every unknown request to
 * the Lambda, so the path must name one resource.
 *
 * @param path - The path of the route.
 * @throws When the path is `$default`, does not start with `/`, or has a greedy parameter.
 */
function validateRoutePath(path: string): void {
  if (path === '$default') {
    throw new Error('The $default route is a catch-all route and is not allowed. Add each route.');
  }
  if (!path.startsWith('/')) {
    throw new Error(`A route path must start with "/": ${path}`);
  }
  if (path.includes('+}')) {
    throw new Error(`A greedy path parameter is a catch-all route and is not allowed: ${path}`);
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
 * An API Gateway HTTP API in front of one traced function (`TracedNodeFunction`, `TracedGoFunction` or
 * `TracedPythonFunction`).
 *
 * - The API has no routes at first. Add each route with `addLambdaRoute`. There is no `$default`
 *   route and no `{proxy+}` route, so a request that matches no route gets a 404 from the gateway
 *   and never reaches the Lambda.
 * - A route uses the JWT authorizer of the Cognito user pool, unless it has `public: true`.
 *   `publicRoutes` lists the public routes. cdk-nag reports `AwsSolutions-APIG4` on each. The
 *   project acknowledges it on exactly those routes with `Validations.of(entry.route).acknowledge`,
 *   in its own acknowledgments file.
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
  /** Every route that `addLambdaRoute` added, in the order of the calls. */
  public get routes(): readonly TracedHttpRoute[] {
    return [...this.routeList];
  }
  /** The routes without an authorizer. */
  public get publicRoutes(): readonly TracedHttpRoute[] {
    return this.routeList.filter((entry) => entry.isPublic);
  }
  /** The access log group. */
  public readonly accessLogGroup: ILogGroup;
  /** The base URL of the API: the custom domain when set, else the `execute-api` URL. */
  public readonly url: string;

  private readonly routeList: TracedHttpRoute[] = [];
  private readonly integrations = new Map<TracedFunctionBase, HttpLambdaIntegration>();
  private readonly usedRouteIds = new Set<string>();
  private readonly usedIntegrationIds = new Set<string>();
  private readonly authorizer: HttpUserPoolAuthorizer;

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

    this.authorizer = new HttpUserPoolAuthorizer('UserPoolAuthorizer', props.userPool, {
      userPoolClients: [props.userPoolClient],
    });

    if (props.domain !== undefined && domainName !== undefined) {
      this.addAliasRecords(props.domain, domainName);
    }
    this.url = props.domain === undefined ? this.stage.url : `https://${domainName?.name ?? ''}`;
  }

  /**
   * Adds one route that sends the request to a traced function. The route uses the JWT authorizer
   * unless `public` is `true`. All routes of one function share one Lambda integration. CDK
   * creates the integration of a function at its first route. If you change which route of a
   * function comes first, the next deploy replaces that integration. CloudFormation handles it.
   *
   * @param props - The method, the path, the function and the `public` flag.
   * @returns The route with its construct.
   * @throws When the path is not valid (see `LambdaRouteProps.path`), or the route exists.
   */
  public addLambdaRoute(props: LambdaRouteProps): TracedHttpRoute {
    validateRoutePath(props.path);
    if (
      this.routeList.some((entry) => entry.method === props.method && entry.path === props.path)
    ) {
      throw new Error(`Duplicate route: ${props.method} ${props.path}`);
    }
    const isPublic = props.public === true;
    const route = new HttpRoute(this, uniqueId(`Route${routeIdSuffix(props)}`, this.usedRouteIds), {
      httpApi: this.api,
      routeKey: HttpRouteKey.with(props.path, props.method),
      integration: this.integrationFor(props.fn),
      ...(isPublic ? {} : { authorizer: this.authorizer }),
    });
    const entry = { method: props.method, path: props.path, isPublic, route };
    this.routeList.push(entry);
    return entry;
  }

  /**
   * Gets the Lambda integration of a function. It creates the integration at the first call.
   *
   * @param target - The traced function.
   * @returns The one integration of the function.
   */
  private integrationFor(target: TracedFunctionBase): HttpLambdaIntegration {
    const known = this.integrations.get(target);
    if (known !== undefined) {
      return known;
    }
    const integration = new HttpLambdaIntegration(
      uniqueId(`${target.node.id}Integration`, this.usedIntegrationIds),
      target.function,
    );
    this.integrations.set(target, integration);
    return integration;
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
 * Builds a PascalCase construct ID part from a route, for example `GetV1Health`.
 *
 * @param route - A route.
 * @returns The ID part. It has only letters and digits.
 */
function routeIdSuffix(route: Pick<LambdaRouteProps, 'method' | 'path'>): string {
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
