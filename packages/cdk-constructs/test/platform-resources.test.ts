import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { HostedZone, TxtRecord } from 'aws-cdk-lib/aws-route53';
import type { IHostedZone } from 'aws-cdk-lib/aws-route53';
import { describe, expect, it } from 'vitest';

import { platformParameterNames } from '../src/platform-parameters.js';
import type { PlatformEnv } from '../src/platform-parameters.js';
import {
  readPlatformCertificate,
  readPlatformDns,
  readPlatformUserPool,
} from '../src/platform-resources.js';

const SSM_VALUE_TYPE = 'AWS::SSM::Parameter::Value<String>';

/** Creates a stack and gives the template one resource, as CloudFormation needs. */
function newStack(): Stack {
  return new Stack(new App(), 'TestStack');
}

/** Imports a fixed zone for the probe records, so the tests do not depend on the SSM zone. */
function probeZone(stack: Stack): IHostedZone {
  return HostedZone.fromHostedZoneAttributes(stack, 'ProbeZone', {
    hostedZoneId: 'Z0000000000000',
    zoneName: 'example.com',
  });
}

/** Finds the logical ID of the one SSM parameter that reads `parameterName`. */
function parameterId(template: Template, parameterName: string): string {
  const found = Object.keys(
    template.findParameters('*', { Type: SSM_VALUE_TYPE, Default: parameterName }),
  );
  expect(found).toHaveLength(1);
  return found[0] ?? '';
}

/** Lists the names of the `/platform/` parameters that a template reads. */
function platformReads(template: Template): string[] {
  return Object.values(template.findParameters('*'))
    .map((parameter) => String(parameter['Default']))
    .filter((name) => name.startsWith('/platform/'))
    .sort();
}

/** Reads the user pool and uses each value in one TXT record, so no parameter is unused. */
function userPoolSetup(env: PlatformEnv = 'prod'): {
  stack: Stack;
  template: Template;
  result: ReturnType<typeof readPlatformUserPool>;
} {
  const stack = newStack();
  const result = readPlatformUserPool(stack, env);
  new TxtRecord(stack, 'ProbeRecord', {
    zone: probeZone(stack),
    values: [result.userPool.userPoolId, result.domainName],
  });
  return { stack, template: Template.fromStack(stack), result };
}

describe('readPlatformUserPool', () => {
  it('reads only the user pool ARN and the domain from SSM, as String parameters', () => {
    const { template } = userPoolSetup();
    const names = platformParameterNames('prod');

    expect(platformReads(template)).toEqual([names.userPoolArn, names.userPoolDomain].sort());
    for (const parameter of Object.values(template.findParameters('*', { Type: SSM_VALUE_TYPE }))) {
      expect(parameter['Type']).toBe(SSM_VALUE_TYPE);
    }
  });

  it('derives the user pool ARN and id from the SSM user pool ARN value', () => {
    const { stack, template, result } = userPoolSetup();
    const arnRef = parameterId(template, platformParameterNames('prod').userPoolArn);

    expect(stack.resolve(result.userPool.userPoolArn)).toEqual({ Ref: arnRef });
    expect(JSON.stringify(stack.resolve(result.userPool.userPoolId))).toContain(arnRef);
  });

  it('wires the domain name to the SSM value', () => {
    const { stack, template, result } = userPoolSetup();

    expect(stack.resolve(result.domainName)).toEqual({
      Ref: parameterId(template, platformParameterNames('prod').userPoolDomain),
    });
  });

  it('reads the parameters of the environment that the caller passes', () => {
    const { template } = userPoolSetup('prod');

    expect(platformReads(template)).toEqual([
      '/platform/prod/cognito/user-pool-arn',
      '/platform/prod/cognito/user-pool-domain',
    ]);
  });

  it('creates no user pool, it only imports', () => {
    const { template } = userPoolSetup();

    expect(template.findResources('AWS::Cognito::UserPool')).toEqual({});
  });

  it('adds one PlatformUserPool child and fails on a second call', () => {
    const { stack } = userPoolSetup();

    expect(stack.node.tryFindChild('PlatformUserPool')).toBeDefined();
    expect(() => readPlatformUserPool(stack, 'prod')).toThrow(/PlatformUserPool/);
  });
});

describe('readPlatformDns', () => {
  it('reads only the two DNS parameters and wires the zone to them', () => {
    const stack = newStack();
    const zone = readPlatformDns(stack, 'prod');
    new TxtRecord(stack, 'ProbeRecord', { zone, values: ['probe'] });
    const template = Template.fromStack(stack);
    const names = platformParameterNames('prod');

    expect(platformReads(template)).toEqual([names.hostedZoneId, names.zoneName].sort());
    expect(stack.resolve(zone.hostedZoneId)).toEqual({
      Ref: parameterId(template, names.hostedZoneId),
    });
    expect(stack.resolve(zone.zoneName)).toEqual({ Ref: parameterId(template, names.zoneName) });
    expect(template.findResources('AWS::Route53::HostedZone')).toEqual({});
  });
});

describe('readPlatformCertificate', () => {
  it('reads only the certificate parameter and wires the ARN to it', () => {
    const stack = newStack();
    const certificate = readPlatformCertificate(stack, 'prod');
    new TxtRecord(stack, 'ProbeRecord', {
      zone: probeZone(stack),
      values: [certificate.certificateArn],
    });
    const template = Template.fromStack(stack);
    const name = platformParameterNames('prod').wildcardCertificateArn;

    expect(platformReads(template)).toEqual([name]);
    expect(stack.resolve(certificate.certificateArn)).toEqual({ Ref: parameterId(template, name) });
    expect(template.findResources('AWS::CertificateManager::Certificate')).toEqual({});
  });
});

describe('independent readers', () => {
  it('lets a stack read the user pool without any DNS or ACM parameter', () => {
    const { template } = userPoolSetup();

    expect(platformReads(template).filter((name) => /\/(dns|acm)\//.test(name))).toEqual([]);
  });

  it('lets the three readers share one stack', () => {
    const stack = newStack();
    const pool = readPlatformUserPool(stack, 'prod');
    const zone = readPlatformDns(stack, 'prod');
    const certificate = readPlatformCertificate(stack, 'prod');
    new TxtRecord(stack, 'ProbeRecord', {
      zone,
      values: [pool.userPool.userPoolId, pool.domainName, certificate.certificateArn],
    });

    expect(platformReads(Template.fromStack(stack))).toHaveLength(5);
  });
});
