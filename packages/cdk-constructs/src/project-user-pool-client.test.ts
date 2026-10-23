import { App, CfnOutput, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';

import { readPlatformUserPool } from './platform-resources.js';
import { createProjectUserPoolClient } from './project-user-pool-client.js';

/** Creates a stack with an imported platform pool and one project client. */
function build(logoutUrls?: readonly string[]): { stack: Stack; template: Template } {
  const stack = new Stack(new App(), 'TestStack');
  const pool = readPlatformUserPool(stack, 'dev');
  // Use the domain value, so CloudFormation does not warn about an unused parameter.
  new CfnOutput(stack, 'SignInDomain', { value: pool.domainName });
  createProjectUserPoolClient(stack, 'WebClient', {
    userPool: pool.userPool,
    callbackUrls: ['https://app.example.com/callback'],
    ...(logoutUrls === undefined ? {} : { logoutUrls }),
  });
  return { stack, template: Template.fromStack(stack) };
}

/** Returns the properties of the one app client in the template. */
function clientProperties(template: Template): Record<string, unknown> {
  const clients = Object.values(template.findResources('AWS::Cognito::UserPoolClient'));
  expect(clients).toHaveLength(1);
  return (clients[0]?.['Properties'] ?? {}) as Record<string, unknown>;
}

describe('createProjectUserPoolClient', () => {
  it('has no secret and supports Google and Cognito sign-in', () => {
    const { template } = build();

    expect(clientProperties(template)).toMatchObject({
      GenerateSecret: false,
      SupportedIdentityProviders: ['Google', 'COGNITO'],
      PreventUserExistenceErrors: 'ENABLED',
      EnableTokenRevocation: true,
    });
  });

  it('uses the authorization code grant only, with openid, email and profile', () => {
    const { template } = build();

    expect(clientProperties(template)).toMatchObject({
      AllowedOAuthFlows: ['code'],
      AllowedOAuthFlowsUserPoolClient: true,
      AllowedOAuthScopes: ['openid', 'email', 'profile'],
      CallbackURLs: ['https://app.example.com/callback'],
    });
  });

  it('sets the logout URLs when given', () => {
    const { template } = build(['https://app.example.com/']);

    expect(clientProperties(template)).toMatchObject({ LogoutURLs: ['https://app.example.com/'] });
  });

  it('sets no logout URL when none is given', () => {
    const { template } = build();

    expect(clientProperties(template)['LogoutURLs']).toEqual([]);
  });

  it('belongs to the platform user pool by the id from the SSM ARN', () => {
    const { template } = build();

    expect(JSON.stringify(clientProperties(template)['UserPoolId'])).toContain(
      'SsmParameterValueplatformdevcognitouserpoolarn',
    );
  });

  it('needs at least one callback URL', () => {
    const stack = new Stack(new App(), 'BadStack');
    const pool = readPlatformUserPool(stack, 'dev');

    expect(() =>
      createProjectUserPoolClient(stack, 'WebClient', {
        userPool: pool.userPool,
        callbackUrls: [],
      }),
    ).toThrow(/callback URL/);
  });
});
