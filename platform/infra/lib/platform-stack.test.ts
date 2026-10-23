import { App, Validations } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { AwsSolutionsChecks } from 'cdk-nag';
import { describe, expect, it } from 'vitest';

import {
  PLATFORM_ENVS,
  allPlatformParameterNames,
  writtenPlatformParameterNames,
} from '@vprprudhvi/shared-cdk-constructs';
import type { PlatformEnv } from '@vprprudhvi/shared-cdk-constructs';

import { loadPlatformConfig } from './config/config.js';
import { GOOGLE_SCOPES, PlatformStack, googleSecretName } from './platform-stack.js';

type Built = { readonly stack: PlatformStack; readonly template: Template };

/** Creates the platform stack for one environment, with the fixed region. */
function build(env: PlatformEnv = 'dev'): Built {
  const stack = new PlatformStack(new App(), 'TestPlatform', {
    config: loadPlatformConfig(env),
    env: { region: 'us-east-1' },
  });
  return { stack, template: Template.fromStack(stack) };
}

/** Returns the one resource of a type: its whole definition. */
function only(template: Template, type: string): Record<string, unknown> {
  const resources = Object.values(template.findResources(type));
  expect(resources).toHaveLength(1);
  return resources[0] ?? {};
}

/** Returns the properties of the one resource of a type. */
function propertiesOf(template: Template, type: string): Record<string, unknown> {
  return only(template, type)['Properties'] as Record<string, unknown>;
}

describe('PlatformStack user pool', () => {
  it('keeps the pool on delete and replace and turns deletion protection on', () => {
    const { template } = build();

    expect(only(template, 'AWS::Cognito::UserPool')).toMatchObject({
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
      Properties: { DeletionProtection: 'ACTIVE' },
    });
  });

  it.each(PLATFORM_ENVS)('retains the pool in %s', (env) => {
    const { template } = build(env);

    expect(only(template, 'AWS::Cognito::UserPool')).toMatchObject({
      DeletionPolicy: 'Retain',
      Properties: { DeletionProtection: 'ACTIVE' },
    });
  });

  it('uses the ESSENTIALS plan, not a paid tier', () => {
    const { template } = build();

    expect(propertiesOf(template, 'AWS::Cognito::UserPool')).toMatchObject({
      UserPoolTier: 'ESSENTIALS',
    });
  });

  it('signs in with the email, case insensitive, and verifies the email', () => {
    const { template } = build();

    expect(propertiesOf(template, 'AWS::Cognito::UserPool')).toMatchObject({
      UsernameAttributes: ['email'],
      UsernameConfiguration: { CaseSensitive: false },
      AutoVerifiedAttributes: ['email'],
    });
  });

  it('has a strong password policy', () => {
    const { template } = build();

    expect(propertiesOf(template, 'AWS::Cognito::UserPool')).toMatchObject({
      Policies: {
        PasswordPolicy: {
          MinimumLength: 12,
          RequireLowercase: true,
          RequireUppercase: true,
          RequireNumbers: true,
          RequireSymbols: true,
        },
      },
    });
  });

  it('has optional MFA with an authenticator app only', () => {
    const { template } = build();

    expect(propertiesOf(template, 'AWS::Cognito::UserPool')).toMatchObject({
      MfaConfiguration: 'OPTIONAL',
      EnabledMfas: ['SOFTWARE_TOKEN_MFA'],
    });
  });

  it('recovers accounts by email only', () => {
    const { template } = build();

    expect(propertiesOf(template, 'AWS::Cognito::UserPool')).toMatchObject({
      AccountRecoverySetting: { RecoveryMechanisms: [{ Name: 'verified_email', Priority: 1 }] },
    });
  });

  it('sets no physical name', () => {
    const { template } = build();

    expect(propertiesOf(template, 'AWS::Cognito::UserPool')).not.toHaveProperty('UserPoolName');
  });

  it.each(PLATFORM_ENVS)('allows only admin-created users in %s (no self sign-up)', (env) => {
    const { template } = build(env);

    expect(propertiesOf(template, 'AWS::Cognito::UserPool')).toMatchObject({
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
    });
  });
});

describe('PlatformStack Google provider', () => {
  it('is a Google provider with the scopes and the attribute mapping', () => {
    const { template } = build();
    const properties = propertiesOf(template, 'AWS::Cognito::UserPoolIdentityProvider');

    expect(GOOGLE_SCOPES).toEqual(['openid', 'email', 'profile']);
    expect(properties).toMatchObject({ ProviderName: 'Google', ProviderType: 'Google' });
    expect(properties['AttributeMapping']).toEqual(
      Object.fromEntries([
        ['email', 'email'],
        ['given_name', 'given_name'],
        ['family_name', 'family_name'],
        ['picture', 'picture'],
      ]),
    );
    expect(properties['ProviderDetails']).toMatchObject(
      Object.fromEntries([['authorize_scopes', 'openid email profile']]),
    );
  });

  it('reads the client ID and the client secret from Secrets Manager by name', () => {
    const { template } = build();
    const details = propertiesOf(template, 'AWS::Cognito::UserPoolIdentityProvider')[
      'ProviderDetails'
    ] as Record<string, string>;

    expect(details['client_id']).toBe(
      '{{resolve:secretsmanager:/platform/dev/cognito/google-oauth:SecretString:clientId::}}',
    );
    expect(details['client_secret']).toBe(
      '{{resolve:secretsmanager:/platform/dev/cognito/google-oauth:SecretString:clientSecret::}}',
    );
  });

  it.each(PLATFORM_ENVS)('uses the secret name of the %s environment', (env) => {
    const { template } = build(env);

    expect(googleSecretName(env)).toBe(`/platform/${env}/cognito/google-oauth`);
    expect(JSON.stringify(template.toJSON())).toContain(
      `{{resolve:secretsmanager:/platform/${env}/cognito/google-oauth:SecretString:clientSecret::}}`,
    );
  });

  it('creates no secret and holds no plain secret value', () => {
    const { template } = build();
    const details = propertiesOf(template, 'AWS::Cognito::UserPoolIdentityProvider')[
      'ProviderDetails'
    ] as Record<string, string>;

    expect(template.findResources('AWS::SecretsManager::Secret')).toEqual({});
    expect(details['client_id']).toMatch(/^\{\{resolve:secretsmanager:/);
    expect(details['client_secret']).toMatch(/^\{\{resolve:secretsmanager:/);
  });

  it('adds one provider only', () => {
    const { template } = build();

    expect(
      Object.keys(template.findResources('AWS::Cognito::UserPoolIdentityProvider')),
    ).toHaveLength(1);
  });
});

describe('PlatformStack hosted sign-in domain', () => {
  it.each(PLATFORM_ENVS)('uses the Cognito prefix domain for %s', (env) => {
    const { template } = build(env);

    expect(propertiesOf(template, 'AWS::Cognito::UserPoolDomain')).toMatchObject({
      Domain: `vprprudhvi-${env}`,
    });
    expect(propertiesOf(template, 'AWS::Cognito::UserPoolDomain')).not.toHaveProperty(
      'CustomDomainConfig',
    );
  });
});

describe('PlatformStack SSM parameters', () => {
  it.each(PLATFORM_ENVS)('writes exactly the names that the contract lists for %s', (env) => {
    const { template } = build(env);
    const names = Object.values(template.findResources('AWS::SSM::Parameter'))
      .map((resource) => String((resource['Properties'] as Record<string, unknown>)['Name']))
      .sort();

    expect(names).toEqual([...writtenPlatformParameterNames(env)].sort());
  });

  it('writes no DNS or ACM name, which are reserved for later', () => {
    const { template } = build();
    const names = Object.values(template.findResources('AWS::SSM::Parameter')).map((resource) =>
      String((resource['Properties'] as Record<string, unknown>)['Name']),
    );

    expect(
      allPlatformParameterNames('dev').filter((name) => /\/(dns|acm)\//.test(name)),
    ).toHaveLength(3);
    expect(names.filter((name) => /\/(dns|acm)\//.test(name))).toEqual([]);
  });

  it('writes the pool ID, the pool ARN and the sign-in host name as String values', () => {
    const { template } = build();
    const poolId = Object.keys(template.findResources('AWS::Cognito::UserPool'))[0] ?? '';
    const domainId = Object.keys(template.findResources('AWS::Cognito::UserPoolDomain'))[0] ?? '';

    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/platform/dev/cognito/user-pool-id',
      Type: 'String',
      Value: { Ref: poolId },
    });
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/platform/dev/cognito/user-pool-arn',
      Type: 'String',
      Value: { 'Fn::GetAtt': [poolId, 'Arn'] },
    });
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/platform/dev/cognito/user-pool-domain',
      Type: 'String',
      Value: { 'Fn::Join': ['', [{ Ref: domainId }, '.auth.us-east-1.amazoncognito.com']] },
    });
    expect(Object.keys(template.findResources('AWS::SSM::Parameter'))).toHaveLength(3);
  });
});

describe('PlatformStack scope', () => {
  it('holds only the pool, the provider, the domain and the three parameters', () => {
    const { template } = build();
    const types = Object.values(template.toJSON()['Resources'] as Record<string, { Type: string }>)
      .map((resource) => resource.Type)
      .sort();

    expect(types).toEqual([
      'AWS::Cognito::UserPool',
      'AWS::Cognito::UserPoolDomain',
      'AWS::Cognito::UserPoolIdentityProvider',
      'AWS::SSM::Parameter',
      'AWS::SSM::Parameter',
      'AWS::SSM::Parameter',
    ]);
  });

  it('creates no app client, no Route53 zone and no certificate', () => {
    const { template } = build();

    expect(template.findResources('AWS::Cognito::UserPoolClient')).toEqual({});
    expect(template.findResources('AWS::Route53::HostedZone')).toEqual({});
    expect(template.findResources('AWS::CertificateManager::Certificate')).toEqual({});
  });

  it('is in us-east-1', () => {
    const { stack } = build();

    expect(stack.region).toBe('us-east-1');
  });
});

describe('PlatformStack cdk-nag', () => {
  // cdk-nag 3 is a validation plugin, so these tests call `validateScope` and read the report.
  // The stack acknowledges two findings, both approved by the owner on 2026-10-22, in
  // `lib/nag-acknowledgments/platform-stack.ts`: COG8 (ESSENTIALS plan) and COG2 (optional MFA).

  /** Lists the violations as `rule id (severity)`. */
  function violations(stack: PlatformStack): string[] {
    return new AwsSolutionsChecks()
      .validateScope(stack)
      .violations.map((violation) => `${violation.ruleName} (${violation.severity ?? 'unknown'})`);
  }

  it.each(PLATFORM_ENVS)('has zero AwsSolutions violations in %s', (env) => {
    expect(violations(build(env).stack)).toEqual([]);
  });

  it('acknowledges exactly COG8 and COG2, each with the owner approval, on the user pool', () => {
    const { stack } = build();
    // Each entry is a map from `<kind>::<rule id>` to the reason.
    const acknowledged = stack.userPool.node.metadata
      .filter((entry) => entry.type === Validations.ACKNOWLEDGED_RULES_METADATA_KEY)
      .flatMap((entry) => Object.entries(entry.data as Record<string, string>));

    expect(acknowledged.map(([id]) => id.replace(/^.*::/, '')).sort()).toEqual([
      'AwsSolutions-COG2',
      'AwsSolutions-COG8',
    ]);
    for (const [, reason] of acknowledged) {
      expect(reason).toContain('Owner approved 2026-10-22');
    }
  });

  it('acknowledges nothing on any other construct of the stack', () => {
    const { stack } = build();
    const others = stack.node
      .findAll()
      .filter((construct) => construct !== stack.userPool)
      .flatMap((construct) =>
        construct.node.metadata.filter(
          (entry) => entry.type === Validations.ACKNOWLEDGED_RULES_METADATA_KEY,
        ),
      );

    expect(others).toEqual([]);
  });
});
