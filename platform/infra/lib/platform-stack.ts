import { Duration, RemovalPolicy, SecretValue, Stack } from 'aws-cdk-lib';
import type { StackProps } from 'aws-cdk-lib';
import {
  AccountRecovery,
  FeaturePlan,
  Mfa,
  ProviderAttribute,
  UserPool,
  UserPoolIdentityProviderGoogle,
} from 'aws-cdk-lib/aws-cognito';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';

import { platformParameterNames } from '@vprprudhvi/shared-cdk-constructs';

import type { PlatformConfig } from './config/platform-config.js';
import { acknowledgePlatformStack } from './nag-acknowledgments/platform-stack.js';

/** Settings for `PlatformStack`. */
export type PlatformStackProps = StackProps & {
  /** The settings of the environment. */
  readonly config: PlatformConfig;
};

/** The Google scopes that the sign-in asks for. */
export const GOOGLE_SCOPES = ['openid', 'email', 'profile'];

/**
 * The name of the Secrets Manager secret with the Google OAuth client. The owner creates it by
 * hand before the first deploy. It is a JSON secret with the keys `clientId` and `clientSecret`.
 *
 * @param env - The environment name.
 * @returns The secret name, `/platform/<env>/cognito/google-oauth`.
 */
export function googleSecretName(env: PlatformConfig['env']): string {
  return `/platform/${env}/cognito/google-oauth`;
}

/**
 * The shared platform stack: one Cognito user pool with Google sign-in and a hosted sign-in
 * domain, and the SSM parameters that projects read. No Route53 zone and no certificate exist
 * yet. Each project makes its own app client on this pool.
 */
export class PlatformStack extends Stack {
  /** The one user pool. */
  public readonly userPool: UserPool;

  /**
   * @param scope - The CDK app.
   * @param id - The stack ID.
   * @param props - The stack props and the environment config.
   */
  public constructor(scope: Construct, id: string, props: PlatformStackProps) {
    const { config, ...stackProps } = props;
    super(scope, id, stackProps);

    this.userPool = new UserPool(this, 'UserPool', {
      // Nobody signs up with an email and a password. Google sign-in still creates users.
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      signInCaseSensitive: false,
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: true } },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: Duration.days(3),
      },
      mfa: Mfa.OPTIONAL,
      mfaSecondFactor: { sms: false, otp: true },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      featurePlan: FeaturePlan.ESSENTIALS,
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const secretName = googleSecretName(config.env);
    // Dynamic references: CloudFormation reads the secret at deploy time. The template has no value.
    new UserPoolIdentityProviderGoogle(this, 'GoogleProvider', {
      userPool: this.userPool,
      clientId: SecretValue.secretsManager(secretName, { jsonField: 'clientId' }).unsafeUnwrap(),
      clientSecretValue: SecretValue.secretsManager(secretName, { jsonField: 'clientSecret' }),
      scopes: GOOGLE_SCOPES,
      attributeMapping: {
        email: ProviderAttribute.GOOGLE_EMAIL,
        givenName: ProviderAttribute.GOOGLE_GIVEN_NAME,
        familyName: ProviderAttribute.GOOGLE_FAMILY_NAME,
        profilePicture: ProviderAttribute.GOOGLE_PICTURE,
      },
    });

    const domain = this.userPool.addDomain('HostedDomain', {
      cognitoDomain: { domainPrefix: `${config.domainPrefix}-${config.env}` },
    });

    const names = platformParameterNames(config.env);
    new StringParameter(this, 'UserPoolIdParameter', {
      parameterName: names.userPoolId,
      stringValue: this.userPool.userPoolId,
      description: 'The ID of the platform Cognito user pool.',
    });
    new StringParameter(this, 'UserPoolArnParameter', {
      parameterName: names.userPoolArn,
      stringValue: this.userPool.userPoolArn,
      description: 'The ARN of the platform Cognito user pool.',
    });
    new StringParameter(this, 'UserPoolDomainParameter', {
      parameterName: names.userPoolDomain,
      stringValue: `${domain.domainName}.auth.${this.region}.amazoncognito.com`,
      description: 'The host name of the hosted sign-in domain of the platform user pool.',
    });

    acknowledgePlatformStack(this.userPool);
  }
}
