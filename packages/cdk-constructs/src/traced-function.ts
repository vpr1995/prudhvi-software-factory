import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import {
  Effect,
  PolicyDocument,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from 'aws-cdk-lib/aws-iam';
import type { IRole } from 'aws-cdk-lib/aws-iam';
import {
  Architecture,
  Function as LambdaFunction,
  LayerVersion,
  Runtime,
  RuntimeFamily,
  Tracing,
} from 'aws-cdk-lib/aws-lambda';
import type { Code } from 'aws-cdk-lib/aws-lambda';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import type { ILogGroup } from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

import type { PlatformEnv } from './platform-parameters.js';

/**
 * The ADOT (AWS Distro for OpenTelemetry) collector-only Lambda layer for arm64 in `us-east-1`.
 * It holds the ADOT collector `v0.49.0` and no SDK. Its default collector config receives OTLP
 * on `localhost:4317` and `localhost:4318` and exports traces to X-Ray (`awsxray` exporter).
 * Do not use the community layer `opentelemetry-collector-*` instead. Its default config only
 * logs to `debug`, and it has no X-Ray exporter.
 *
 * Source: https://github.com/aws-observability/aws-otel-lambda (README, "Collector layer
 * aws-otel-collector-<amd64|arm64>-ver-0-156-0", release `v0.156.0`) and
 * https://aws-otel.github.io/docs/getting-started/lambda/lambda-go (ARN format
 * `arn:aws:lambda:<region>:901920570463:layer:aws-otel-collector-<architecture>-ver-0-156-0:4`).
 * To upgrade, take the new ARN from the same pages and check the collector config still exports
 * to X-Ray.
 */
export const ADOT_COLLECTOR_LAYER_ARN =
  'arn:aws:lambda:us-east-1:901920570463:layer:aws-otel-collector-arm64-ver-0-156-0:4';

/** The OTLP endpoint of the collector in the layer. */
export const OTEL_COLLECTOR_ENDPOINT = 'http://localhost:4318';

/** The propagators: W3C trace context, baggage, and the X-Ray header. */
export const OTEL_PROPAGATORS_VALUE = 'tracecontext,baggage,xray';

/** The sampler: follow the parent decision, else sample by trace id ratio. */
export const OTEL_TRACES_SAMPLER_VALUE = 'parentbased_traceidratio';

/** The share of root traces to sample in `dev` and `staging`. */
export const OTEL_SAMPLER_ARG_NON_PROD = '1.0';

/** The share of root traces to sample in `prod`. */
export const OTEL_SAMPLER_ARG_PROD = '0.1';

/** Environment variables that `TracedFunction` owns. A caller cannot set them. */
export const RESERVED_ENVIRONMENT_KEYS = [
  'OTEL_SERVICE_NAME',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_PROPAGATORS',
  'OTEL_TRACES_SAMPLER',
  'OTEL_TRACES_SAMPLER_ARG',
  'AWS_LAMBDA_EXEC_WRAPPER',
] as const;

const DEFAULT_MEMORY_MB = 512;
const DEFAULT_TIMEOUT_SECONDS = 10;

/** Settings for `TracedFunction`. */
export type TracedFunctionProps = {
  /** The service name. It becomes `OTEL_SERVICE_NAME`. */
  readonly serviceName: string;
  /** The deployment environment. It sets the trace sampling ratio: 1.0 in non-prod, 0.1 in prod. */
  readonly env: PlatformEnv;
  /** The function code. */
  readonly code: Code;
  /** The handler. For `provided.al2023` use `bootstrap`. */
  readonly handler: string;
  /** A Node.js, Python or `provided.al2023` runtime. Other runtimes throw. */
  readonly runtime: Runtime;
  /** Memory in MB. Defaults to 512. */
  readonly memorySize?: number;
  /** Timeout. Defaults to 10 seconds. */
  readonly timeout?: Duration;
  /** Extra environment variables. The `OTEL_*` keys and `AWS_LAMBDA_EXEC_WRAPPER` are reserved. */
  readonly environment?: Readonly<Record<string, string>>;
  /** How long the log group keeps logs. Defaults to one month. */
  readonly logRetention?: RetentionDays;
};

/**
 * Checks that the runtime is a Node.js, Python or `provided.al2023` runtime.
 *
 * @param runtime - The runtime of the function.
 * @returns `true` when the function can use the collector layer in this repo.
 */
function isSupportedRuntime(runtime: Runtime): boolean {
  return (
    runtime.family === RuntimeFamily.NODEJS ||
    runtime.family === RuntimeFamily.PYTHON ||
    runtime.name === Runtime.PROVIDED_AL2023.name
  );
}

/**
 * Builds the OpenTelemetry environment variables of a function.
 *
 * @param props - The service name and the environment.
 * @returns The five `OTEL_*` variables.
 */
function buildTelemetryEnvironment(
  props: Pick<TracedFunctionProps, 'env' | 'serviceName'>,
): Record<string, string> {
  return {
    OTEL_SERVICE_NAME: props.serviceName,
    OTEL_EXPORTER_OTLP_ENDPOINT: OTEL_COLLECTOR_ENDPOINT,
    OTEL_PROPAGATORS: OTEL_PROPAGATORS_VALUE,
    OTEL_TRACES_SAMPLER: OTEL_TRACES_SAMPLER_VALUE,
    OTEL_TRACES_SAMPLER_ARG:
      props.env === 'prod' ? OTEL_SAMPLER_ARG_PROD : OTEL_SAMPLER_ARG_NON_PROD,
  };
}

/**
 * The one Lambda construct for project code. It runs on arm64 with X-Ray active tracing, the ADOT
 * collector-only layer, the OpenTelemetry environment variables, its own log group with
 * retention, and an explicit role that can write only to that log group.
 *
 * It sets no `AWS_LAMBDA_EXEC_WRAPPER`. The app starts the SDK itself (`initTelemetry`).
 */
export class TracedFunction extends Construct {
  /** The Lambda function. Use it for integrations and grants. */
  public readonly function: LambdaFunction;
  /** The log group of the function. */
  public readonly logGroup: ILogGroup;
  /** The execution role of the function. */
  public readonly role: IRole;

  /**
   * @param scope - The parent construct.
   * @param id - The construct ID, in PascalCase.
   * @param props - The function settings.
   */
  public constructor(scope: Construct, id: string, props: TracedFunctionProps) {
    super(scope, id);

    if (!isSupportedRuntime(props.runtime)) {
      throw new Error(
        `TracedFunction supports Node.js, Python and provided.al2023 runtimes, not ${props.runtime.name}.`,
      );
    }
    const reserved = RESERVED_ENVIRONMENT_KEYS.filter(
      (key) => props.environment !== undefined && key in props.environment,
    );
    if (reserved.length > 0) {
      throw new Error(
        `TracedFunction sets these environment variables itself: ${reserved.join(', ')}.`,
      );
    }

    const logGroup = new LogGroup(this, 'LogGroup', {
      retention: props.logRetention ?? RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const role = new Role(this, 'Role', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      inlinePolicies: {
        WriteLogs: new PolicyDocument({
          statements: [
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
              resources: [logGroup.logGroupArn, `${logGroup.logGroupArn}:*`],
            }),
          ],
        }),
      },
    });

    this.function = new LambdaFunction(this, 'Function', {
      runtime: props.runtime,
      architecture: Architecture.ARM_64,
      code: props.code,
      handler: props.handler,
      memorySize: props.memorySize ?? DEFAULT_MEMORY_MB,
      timeout: props.timeout ?? Duration.seconds(DEFAULT_TIMEOUT_SECONDS),
      tracing: Tracing.ACTIVE,
      logGroup,
      role,
      layers: [
        LayerVersion.fromLayerVersionArn(this, 'OtelCollectorLayer', ADOT_COLLECTOR_LAYER_ARN),
      ],
      environment: { ...props.environment, ...buildTelemetryEnvironment(props) },
    });
    this.logGroup = logGroup;
    this.role = role;
  }
}
