import { Duration, RemovalPolicy, Stack, Validations } from 'aws-cdk-lib';
import {
  Effect,
  PolicyDocument,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from 'aws-cdk-lib/aws-iam';
import type { IRole } from 'aws-cdk-lib/aws-iam';
import { Architecture, LayerVersion, Tracing } from 'aws-cdk-lib/aws-lambda';
import type { Function as LambdaFunction, FunctionOptions } from 'aws-cdk-lib/aws-lambda';
import { CfnLogGroup, LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
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

/** Environment variables that every traced function owns. A caller cannot set them. */
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

/**
 * Settings that all three traced functions share (`TracedNodeFunction`, `TracedGoFunction` and
 * `TracedPythonFunction`).
 */
export type TracedFunctionBaseProps = {
  /** The service name. It becomes `OTEL_SERVICE_NAME`. */
  readonly serviceName: string;
  /** The deployment environment. It sets the trace sampling ratio: 1.0 in non-prod, 0.1 in prod. */
  readonly env: PlatformEnv;
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
 * Builds the OpenTelemetry environment variables of a function.
 *
 * @param props - The service name and the environment.
 * @returns The five `OTEL_*` variables.
 */
function buildTelemetryEnvironment(
  props: Pick<TracedFunctionBaseProps, 'env' | 'serviceName'>,
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
 * The base of every Lambda construct for project code. It holds the logic that all three runtimes
 * share, so it exists in one place:
 *
 * - arm64, X-Ray active tracing and the ADOT collector-only layer,
 * - the OpenTelemetry environment variables (sampling 1.0 in non-prod, 0.1 in prod),
 * - its own log group with retention, and an explicit role that can write only to that log group,
 * - the two owner-approved `AwsSolutions-IAM5` acknowledgments.
 *
 * It sets no `AWS_LAMBDA_EXEC_WRAPPER`. The app starts the SDK itself (`initTelemetry`).
 *
 * Do not use this class directly. Use `TracedNodeFunction`, `TracedGoFunction` or
 * `TracedPythonFunction`. A subclass creates its function with `this.functionOptions`, then
 * calls `this.completeSetup()`.
 */
export abstract class TracedFunctionBase extends Construct {
  /** The Lambda function. Use it for integrations and grants. */
  public abstract readonly function: LambdaFunction;
  /** The log group of the function. */
  public readonly logGroup: ILogGroup;
  /** The execution role of the function. */
  public readonly role: IRole;

  /**
   * The function settings that all runtimes share. A subclass spreads them into the props of its
   * function. They hold the architecture, tracing, layer, log group, role, environment, memory
   * and timeout. They hold no runtime, code or handler.
   */
  protected readonly functionOptions: FunctionOptions;

  private readonly ownLogGroup: LogGroup;
  private readonly ownRole: Role;

  /**
   * @param scope - The parent construct.
   * @param id - The construct ID, in PascalCase.
   * @param props - The settings that all runtimes share.
   */
  protected constructor(scope: Construct, id: string, props: TracedFunctionBaseProps) {
    super(scope, id);

    const reserved = RESERVED_ENVIRONMENT_KEYS.filter(
      (key) => props.environment !== undefined && key in props.environment,
    );
    if (reserved.length > 0) {
      throw new Error(
        `A traced function sets these environment variables itself: ${reserved.join(', ')}.`,
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

    this.functionOptions = {
      architecture: Architecture.ARM_64,
      memorySize: props.memorySize ?? DEFAULT_MEMORY_MB,
      timeout: props.timeout ?? Duration.seconds(DEFAULT_TIMEOUT_SECONDS),
      tracing: Tracing.ACTIVE,
      logGroup,
      role,
      layers: [
        LayerVersion.fromLayerVersionArn(this, 'OtelCollectorLayer', ADOT_COLLECTOR_LAYER_ARN),
      ],
      environment: { ...props.environment, ...buildTelemetryEnvironment(props) },
    };
    this.logGroup = logGroup;
    this.role = role;
    this.ownLogGroup = logGroup;
    this.ownRole = role;
  }

  /**
   * Finishes the setup. A subclass calls it after it creates its function, because the X-Ray
   * statement of the role exists only after that.
   *
   * It acknowledges the two `AwsSolutions-IAM5` findings that this construct cannot remove. The
   * repo owner approved both on 2026-10-22. They apply to this role only.
   */
  protected completeSetup(): void {
    // cdk-nag names the finding after the logical ID of the log group, so build it from the ID.
    const cfnLogGroup = this.ownLogGroup.node.defaultChild;
    if (!(cfnLogGroup instanceof CfnLogGroup)) {
      throw new TypeError('The log group has no CfnLogGroup child.');
    }
    const logGroupLogicalId = Stack.of(this).getLogicalId(cfnLogGroup);
    Validations.of(this.ownRole).acknowledge({
      id: `AwsSolutions-IAM5[Resource::<${logGroupLogicalId}.Arn>:*]`,
      reason:
        'Lambda log stream names are dynamic, so the log write needs the log group ARN with ":*". ' +
        'The policy is limited to the log group of this function. Owner approved 2026-10-22.',
    });
    Validations.of(this.ownRole.node.findChild('DefaultPolicy')).acknowledge({
      id: 'AwsSolutions-IAM5[Resource::*]',
      reason:
        'X-Ray PutTraceSegments and PutTelemetryRecords have no resource-level permission, so CDK ' +
        'writes "Resource: *" for active tracing. Owner approved 2026-10-22.',
    });
  }
}
