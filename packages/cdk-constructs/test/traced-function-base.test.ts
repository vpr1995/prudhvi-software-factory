import { Duration, Validations } from 'aws-cdk-lib';
import type { Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { AwsSolutionsChecks } from 'cdk-nag';
import { describe, expect, it } from 'vitest';

import type { DeployEnv } from '../src/platform-parameters.js';
import {
  ADOT_COLLECTOR_LAYER_ARN,
  RESERVED_ENVIRONMENT_KEYS,
} from '../src/traced-function-base.js';

import { KINDS, createFunction, newStack } from './support/functions.js';
import type { CommonOverrides, Kind } from './support/functions.js';

type Built = { readonly stack: Stack; readonly template: Template };

/** The Lambda runtime name that each kind must give. */
const RUNTIMES: Record<Kind, string> = {
  node: 'nodejs24.x',
  go: 'provided.al2023',
  python: 'python3.14',
};

/** Creates a stack with one traced function of one kind. The context turns bundling off. */
function build(kind: Kind, overrides: CommonOverrides = {}): Built {
  const stack = newStack();
  createFunction(kind, stack, overrides);
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

describe.each(KINDS)('traced %s function: function settings', (kind) => {
  it('runs on arm64 with X-Ray active tracing, memory and timeout', () => {
    const { template } = build(kind);

    expect(
      findWith(template, 'AWS::Lambda::Function', {
        Runtime: RUNTIMES[kind],
        Architectures: ['arm64'],
        TracingConfig: { Mode: 'Active' },
        MemorySize: 512,
        Timeout: 10,
      }),
    ).toHaveLength(1);
  });

  it('takes memory and timeout from the props', () => {
    const { template } = build(kind, { memorySize: 1024, timeout: Duration.seconds(25) });

    expect(
      findWith(template, 'AWS::Lambda::Function', { MemorySize: 1024, Timeout: 25 }),
    ).toHaveLength(1);
  });

  it('creates no custom resource for log retention', () => {
    const { template } = build(kind);

    expect(template.findResources('Custom::LogRetention')).toEqual({});
    expect(template.findResources('AWS::Lambda::Function')).not.toEqual({});
  });
});

describe.each(KINDS)('traced %s function: telemetry', (kind) => {
  it('adds the ADOT collector layer and no other layer', () => {
    const { template } = build(kind);

    expect(
      findWith(template, 'AWS::Lambda::Function', { Layers: [ADOT_COLLECTOR_LAYER_ARN] }),
    ).toHaveLength(1);
  });

  it('sets the OpenTelemetry environment variables for local', () => {
    const { template } = build(kind);

    expect(functionEnvironment(template)['OTEL_SERVICE_NAME']).toMatch(/^sample-api/);
    expect(functionEnvironment(template)).toMatchObject({
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
      OTEL_PROPAGATORS: 'tracecontext,baggage,xray',
      OTEL_TRACES_SAMPLER: 'parentbased_traceidratio',
      OTEL_TRACES_SAMPLER_ARG: '1.0',
    });
  });

  it('takes the service name from the props', () => {
    const { template } = build(kind, { serviceName: 'orders' });

    expect(functionEnvironment(template)['OTEL_SERVICE_NAME']).toBe('orders');
  });

  it.each([
    ['local', '1.0'],
    ['prod', '0.1'],
  ] satisfies [DeployEnv, string][])('samples %s at ratio %s', (env, ratio) => {
    const { template } = build(kind, { env });

    expect(functionEnvironment(template)['OTEL_TRACES_SAMPLER_ARG']).toBe(ratio);
  });

  it('never sets AWS_LAMBDA_EXEC_WRAPPER', () => {
    const { template } = build(kind, { environment: { TABLE: 'orders' } });

    expect(functionEnvironment(template)).not.toHaveProperty('AWS_LAMBDA_EXEC_WRAPPER');
  });

  it('keeps extra environment variables from the caller', () => {
    const { template } = build(kind, { environment: { TABLE: 'orders' } });

    expect(functionEnvironment(template)).toMatchObject({ TABLE: 'orders' });
  });

  it.each(RESERVED_ENVIRONMENT_KEYS)('rejects the reserved variable %s', (key) => {
    expect(() => build(kind, { environment: { [key]: 'x' } })).toThrow(key);
  });
});

describe.each(KINDS)('traced %s function: logs and role', (kind) => {
  it('creates its own log group with one month retention by default', () => {
    const { template } = build(kind);
    const [group] = Object.values(template.findResources('AWS::Logs::LogGroup'));

    expect(group).toMatchObject({
      Properties: { RetentionInDays: 30 },
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
    });
    expect(logGroupId(template)).not.toBe('');
  });

  it('takes the retention from the props', () => {
    const { template } = build(kind, { logRetention: RetentionDays.ONE_YEAR });

    expect(findWith(template, 'AWS::Logs::LogGroup', { RetentionInDays: 365 })).toHaveLength(1);
  });

  it('points the function at its log group', () => {
    const { template } = build(kind);

    expect(
      findWith(template, 'AWS::Lambda::Function', {
        LoggingConfig: { LogGroup: { Ref: logGroupId(template) } },
      }),
    ).toHaveLength(1);
  });

  it('uses one explicit role with no managed policy', () => {
    const { template } = build(kind);

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
    const { template } = build(kind);
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

  it('exposes the function, the log group and the role', () => {
    const stack = newStack();

    const construct = createFunction(kind, stack);

    expect(construct.function.node.id).toBe('Function');
    expect(construct.logGroup.node.id).toBe('LogGroup');
    expect(construct.role.node.id).toBe('Role');
  });
});

describe.each(KINDS)('traced %s function: cdk-nag', (kind) => {
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
    expect(violationNames(build(kind).stack)).toEqual([]);
  });

  it('has zero violations for a function in prod', () => {
    expect(violationNames(build(kind, { env: 'prod' }).stack)).toEqual([]);
  });

  it('does not acknowledge more than the two IAM5 findings', () => {
    const { stack } = build(kind);
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

describe('traced functions together', () => {
  it('has zero violations for a function of each kind in one stack', () => {
    const stack = newStack();
    for (const kind of KINDS) {
      createFunction(kind, stack, { serviceName: kind, id: `${kind}Api` });
    }

    expect(
      new AwsSolutionsChecks()
        .validateScope(stack)
        .violations.map((violation) => violation.ruleName),
    ).toEqual([]);
    expect(
      Object.keys(Template.fromStack(stack).findResources('AWS::Lambda::Function')),
    ).toHaveLength(3);
  });
});
