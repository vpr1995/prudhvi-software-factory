import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { TxtRecord } from 'aws-cdk-lib/aws-route53';
import { describe, expect, it } from 'vitest';

import { platformParameterNames } from './platform-parameters.js';
import type { PlatformEnv } from './platform-parameters.js';
import { readPlatformResources } from './platform-resources.js';

const SSM_VALUE_TYPE = 'AWS::SSM::Parameter::Value<String>';

type TestSetup = {
  readonly stack: Stack;
  readonly template: Template;
  readonly resources: ReturnType<typeof readPlatformResources>;
};

/**
 * Creates a stack that reads the platform resources and uses each one in one TXT record.
 * The record gives the template a resource, as CloudFormation needs, and references each value.
 */
function setup(env: PlatformEnv = 'dev'): TestSetup {
  const stack = new Stack(new App(), 'TestStack');
  const resources = readPlatformResources(stack, env);
  new TxtRecord(stack, 'ProbeRecord', {
    zone: resources.hostedZone,
    values: [resources.userPool.userPoolId, resources.wildcardCertificate.certificateArn],
  });
  return { stack, template: Template.fromStack(stack), resources };
}

/** Finds the logical ID of the one SSM parameter that reads `parameterName`. */
function parameterId(template: Template, parameterName: string): string {
  const found = Object.keys(
    template.findParameters('*', { Type: SSM_VALUE_TYPE, Default: parameterName }),
  );
  expect(found).toHaveLength(1);
  return found[0] ?? '';
}

describe('readPlatformResources', () => {
  it('reads each used platform value from SSM with the String value parameter type', () => {
    const { template } = setup();
    const names = platformParameterNames('dev');

    const defaults = Object.values(template.findParameters('*', { Type: SSM_VALUE_TYPE })).map(
      (parameter) => String(parameter['Default']),
    );

    expect(defaults).toEqual(
      expect.arrayContaining([
        names.userPoolArn,
        names.hostedZoneId,
        names.zoneName,
        names.wildcardCertificateArn,
      ]),
    );
  });

  it('reads no other platform parameter than the four it uses', () => {
    const { template } = setup();
    const platformReads = Object.values(template.findParameters('*')).filter((parameter) =>
      String(parameter['Default']).startsWith('/platform/'),
    );

    expect(platformReads).toHaveLength(4);
  });

  it('creates no user pool, hosted zone or certificate, it only imports them', () => {
    const { template } = setup();

    expect(template.findResources('AWS::Cognito::UserPool')).toEqual({});
    expect(template.findResources('AWS::Route53::HostedZone')).toEqual({});
    expect(template.findResources('AWS::CertificateManager::Certificate')).toEqual({});
  });

  it('wires the hosted zone id and zone name to the SSM values', () => {
    const { stack, template, resources } = setup();
    const names = platformParameterNames('dev');

    expect(stack.resolve(resources.hostedZone.hostedZoneId)).toEqual({
      Ref: parameterId(template, names.hostedZoneId),
    });
    expect(stack.resolve(resources.hostedZone.zoneName)).toEqual({
      Ref: parameterId(template, names.zoneName),
    });
    template.hasResourceProperties('AWS::Route53::RecordSet', {
      HostedZoneId: { Ref: parameterId(template, names.hostedZoneId) },
    });
  });

  it('wires the certificate ARN to the SSM value', () => {
    const { stack, template, resources } = setup();

    expect(stack.resolve(resources.wildcardCertificate.certificateArn)).toEqual({
      Ref: parameterId(template, platformParameterNames('dev').wildcardCertificateArn),
    });
  });

  it('derives the user pool ARN and id from the SSM user pool ARN value', () => {
    const { stack, template, resources } = setup();
    const arnRef = parameterId(template, platformParameterNames('dev').userPoolArn);

    expect(stack.resolve(resources.userPool.userPoolArn)).toEqual({ Ref: arnRef });
    expect(JSON.stringify(stack.resolve(resources.userPool.userPoolId))).toContain(arnRef);
  });

  it('reads the parameters of the environment that the caller passes', () => {
    const { template } = setup('prod');

    expect(parameterId(template, '/platform/prod/dns/zone-name')).not.toBe('');
    expect(
      Object.values(template.findParameters('*')).filter((parameter) =>
        String(parameter['Default']).startsWith('/platform/dev/'),
      ),
    ).toHaveLength(0);
  });

  it('adds one PlatformResources child to the scope', () => {
    const { stack } = setup();

    expect(stack.node.tryFindChild('PlatformResources')).toBeDefined();
  });

  it('fails when called two times for one scope', () => {
    const { stack } = setup();

    expect(() => readPlatformResources(stack, 'dev')).toThrow(/PlatformResources/);
  });
});
