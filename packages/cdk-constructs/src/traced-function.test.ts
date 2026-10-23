import { App, Duration, Stack, Validations } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { Code, Runtime } from 'aws-cdk-lib/aws-lambda';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { AwsSolutionsChecks } from 'cdk-nag';
import { describe, expect, it } from 'vitest';

import type { PlatformEnv } from './platform-parameters.js';
import {
  ADOT_COLLECTOR_LAYER_ARN,
  RESERVED_ENVIRONMENT_KEYS,
  TracedFunction,
} from './traced-function.js';
import type { TracedFunctionProps } from './traced-function.js';

type Overrides = Partial<TracedFunctionProps>;

/** Creates a stack with one `TracedFunction`. The code comes from a bucket, so any runtime works. */
function build(overrides: Overrides = {}): { stack: Stack; template: Template } {
  const stack = new Stack(new App(), 'TestStack');
  new TracedFunction(stack, 'Api', {
    serviceName: 'sample-api',
    env: 'dev',
    code: Code.fromBucket(Bucket.fromBucketName(stack, 'CodeBucket', 'code-bucket'), 'code.zip'),
    handler: 'index.handler',
    runtime: Runtime.NODEJS_24_X,
    ...overrides,
  });
  return { stack, template: Template.fromStack(stack) };
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

/** Reads the environment variables of the one function in the template. */
function functionEnvironment(template: Template): Record<string, string> {
  const environment = propertiesOf(template, 'AWS::Lambda::Function')['Environment'];
  return (environment as { Variables: Record<string, string> }).Variables;
}

/** Returns the logical ID of the one log group in the template. */
function logGroupId(template: Template): string {
  const ids = Object.keys(template.findResources('AWS::Logs::LogGroup'));
  expect(ids).toHaveLength(1);
  return ids[0] ?? '';
}

describe('TracedFunction function settings', () => {
  it('runs on arm64 with X-Ray active tracing, memory and timeout', () => {
    const { template } = build();

    expect(
      findWith(template, 'AWS::Lambda::Function', {
        Architectures: ['arm64'],
        TracingConfig: { Mode: 'Active' },
        MemorySize: 512,
        Timeout: 10,
      }),
    ).toHaveLength(1);
  });

  it('takes memory and timeout from the props', () => {
    const { template } = build({ memorySize: 1024, timeout: Duration.seconds(25) });

    expect(
      findWith(template, 'AWS::Lambda::Function', { MemorySize: 1024, Timeout: 25 }),
    ).toHaveLength(1);
  });

  it.each([
    ['node', Runtime.NODEJS_24_X, 'nodejs24.x'],
    ['python', Runtime.PYTHON_3_14, 'python3.14'],
    ['provided.al2023', Runtime.PROVIDED_AL2023, 'provided.al2023'],
  ])('accepts the %s runtime on arm64', (_label, runtime, name) => {
    const { template } = build({ runtime, handler: 'bootstrap' });

    expect(
      findWith(template, 'AWS::Lambda::Function', { Runtime: name, Architectures: ['arm64'] }),
    ).toHaveLength(1);
  });

  it('rejects a Java runtime', () => {
    expect(() => build({ runtime: Runtime.JAVA_21 })).toThrow(
      /Node.js, Python and provided.al2023/,
    );
  });

  it('creates no custom resource for log retention', () => {
    const { template } = build();

    expect(template.findResources('Custom::LogRetention')).toEqual({});
    expect(template.findResources('AWS::Lambda::Function')).not.toEqual({});
  });
});

describe('TracedFunction telemetry', () => {
  it('adds the ADOT collector layer and no other layer', () => {
    const { template } = build();

    expect(
      findWith(template, 'AWS::Lambda::Function', { Layers: [ADOT_COLLECTOR_LAYER_ARN] }),
    ).toHaveLength(1);
  });

  it('uses an arm64 us-east-1 layer ARN in the documented format', () => {
    expect(ADOT_COLLECTOR_LAYER_ARN).toMatch(
      /^arn:aws:lambda:us-east-1:\d{12}:layer:aws-otel-collector-arm64-ver-\d+-\d+-\d+:\d+$/,
    );
  });

  it('sets the OpenTelemetry environment variables for dev', () => {
    const { template } = build();

    expect(functionEnvironment(template)).toEqual({
      OTEL_SERVICE_NAME: 'sample-api',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
      OTEL_PROPAGATORS: 'tracecontext,baggage,xray',
      OTEL_TRACES_SAMPLER: 'parentbased_traceidratio',
      OTEL_TRACES_SAMPLER_ARG: '1.0',
    });
  });

  it.each([
    ['dev', '1.0'],
    ['staging', '1.0'],
    ['prod', '0.1'],
  ] satisfies [PlatformEnv, string][])('samples %s at ratio %s', (env, ratio) => {
    const { template } = build({ env });

    expect(functionEnvironment(template)['OTEL_TRACES_SAMPLER_ARG']).toBe(ratio);
  });

  it('never sets AWS_LAMBDA_EXEC_WRAPPER', () => {
    const { template } = build({ environment: { TABLE: 'orders' } });

    expect(functionEnvironment(template)).not.toHaveProperty('AWS_LAMBDA_EXEC_WRAPPER');
  });

  it('keeps extra environment variables from the caller', () => {
    const { template } = build({ environment: { TABLE: 'orders' } });

    expect(functionEnvironment(template)).toMatchObject({ TABLE: 'orders' });
  });

  it.each(RESERVED_ENVIRONMENT_KEYS)('rejects the reserved variable %s', (key) => {
    expect(() => build({ environment: { [key]: 'x' } })).toThrow(key);
  });
});

describe('TracedFunction logs and role', () => {
  it('creates its own log group with one month retention by default', () => {
    const { template } = build();
    const [group] = Object.values(template.findResources('AWS::Logs::LogGroup'));

    expect(group).toMatchObject({
      Properties: { RetentionInDays: 30 },
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
    });
    expect(logGroupId(template)).not.toBe('');
  });

  it('takes the retention from the props', () => {
    const { template } = build({ logRetention: RetentionDays.ONE_YEAR });

    expect(findWith(template, 'AWS::Logs::LogGroup', { RetentionInDays: 365 })).toHaveLength(1);
  });

  it('points the function at its log group', () => {
    const { template } = build();

    expect(
      findWith(template, 'AWS::Lambda::Function', {
        LoggingConfig: { LogGroup: { Ref: logGroupId(template) } },
      }),
    ).toHaveLength(1);
  });

  it('uses one explicit role with no managed policy', () => {
    const { template } = build();

    expect(Object.keys(template.findResources('AWS::IAM::Role'))).toHaveLength(1);
    expect(propertiesOf(template, 'AWS::IAM::Role')).not.toHaveProperty('ManagedPolicyArns');
    expect(
      findWith(template, 'AWS::IAM::Role', {
        AssumeRolePolicyDocument: {
          Statement: [
            {
              Action: 'sts:AssumeRole',
              Effect: 'Allow',
              Principal: { Service: 'lambda.amazonaws.com' },
            },
          ],
        },
      }),
    ).toHaveLength(1);
  });

  it('limits log writes to the log group of the function', () => {
    const { template } = build();
    const groupArn = { 'Fn::GetAtt': [logGroupId(template), 'Arn'] };

    expect(
      findWith(template, 'AWS::IAM::Role', {
        Policies: [
          {
            PolicyName: 'WriteLogs',
            PolicyDocument: {
              Statement: [
                {
                  Effect: 'Allow',
                  Action: ['logs:CreateLogStream', 'logs:PutLogEvents'],
                  Resource: [groupArn, { 'Fn::Join': ['', [groupArn, ':*']] }],
                },
              ],
            },
          },
        ],
      }),
    ).toHaveLength(1);
  });
});

describe('TracedFunction cdk-nag', () => {
  // cdk-nag 3 is a validation plugin. A plugin on the App makes synth throw on a violation, so
  // these tests call `validateScope` and read the report.
  // The construct acknowledges two AwsSolutions-IAM5 findings (owner approved 2026-10-22):
  // X-Ray `Resource: *` and the log stream `:*`. Nothing else is acknowledged.

  /** Lists the rule names of all violations. */
  function violationNames(stack: Stack): string[] {
    return new AwsSolutionsChecks()
      .validateScope(stack)
      .violations.map((violation) => violation.ruleName);
  }

  it('has zero AwsSolutions violations', () => {
    const { stack } = build();

    expect(violationNames(stack)).toEqual([]);
  });

  it.each([Runtime.PYTHON_3_14, Runtime.PROVIDED_AL2023])(
    'has zero AwsSolutions violations for the %s runtime',
    (runtime) => {
      const { stack } = build({ runtime, handler: 'bootstrap' });

      expect(violationNames(stack)).toEqual([]);
    },
  );

  it('has zero violations for two functions in one stack', () => {
    const { stack } = build();
    new TracedFunction(stack, 'Worker', {
      serviceName: 'worker',
      env: 'prod',
      code: Code.fromBucket(Bucket.fromBucketName(stack, 'WorkerCode', 'worker-code'), 'w.zip'),
      handler: 'index.handler',
      runtime: Runtime.NODEJS_24_X,
    });

    expect(violationNames(stack)).toEqual([]);
  });

  it('does not acknowledge more than the two IAM5 findings', () => {
    const { stack } = build();
    const role = stack.node.findChild('Api').node.findChild('Role');
    const metadata = role.node.metadata.concat(role.node.findChild('DefaultPolicy').node.metadata);
    const ids = metadata
      .filter((entry) => entry.type === Validations.ACKNOWLEDGED_RULES_METADATA_KEY)
      .flatMap((entry) => JSON.stringify(entry.data));

    expect(ids).toHaveLength(2);
    expect(ids.join('')).toContain('AwsSolutions-IAM5[Resource::*]');
    expect(ids.join('')).toContain('Owner approved 2026-10-22');
  });
});
