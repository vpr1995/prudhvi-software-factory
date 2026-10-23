import {
  OAuthScope,
  UserPoolClient,
  UserPoolClientIdentityProvider,
} from 'aws-cdk-lib/aws-cognito';
import type { IUserPool } from 'aws-cdk-lib/aws-cognito';
import type { Construct } from 'constructs';

/** Settings for `createProjectUserPoolClient`. */
export type ProjectUserPoolClientProps = {
  /** The platform user pool (from `readPlatformUserPool`). */
  readonly userPool: IUserPool;
  /** The URLs that the hosted sign-in may redirect to after sign-in. At least one. */
  readonly callbackUrls: readonly string[];
  /** The URLs that the hosted sign-in may redirect to after sign-out. */
  readonly logoutUrls?: readonly string[];
};

/**
 * Creates the app client of one project on the platform user pool. A browser client has no
 * secret. It signs in with Google or with Cognito (email and password), through the
 * authorization code grant. Each project makes its own client.
 *
 * @param scope - The project stack.
 * @param id - The construct ID, in PascalCase.
 * @param props - The user pool and the redirect URLs.
 * @returns The app client.
 */
export function createProjectUserPoolClient(
  scope: Construct,
  id: string,
  props: ProjectUserPoolClientProps,
): UserPoolClient {
  if (props.callbackUrls.length === 0) {
    throw new Error('A project app client needs at least one callback URL.');
  }
  return new UserPoolClient(scope, id, {
    userPool: props.userPool,
    generateSecret: false,
    preventUserExistenceErrors: true,
    enableTokenRevocation: true,
    supportedIdentityProviders: [
      UserPoolClientIdentityProvider.GOOGLE,
      UserPoolClientIdentityProvider.COGNITO,
    ],
    oAuth: {
      flows: { authorizationCodeGrant: true },
      scopes: [OAuthScope.OPENID, OAuthScope.EMAIL, OAuthScope.PROFILE],
      callbackUrls: [...props.callbackUrls],
      logoutUrls: [...(props.logoutUrls ?? [])],
    },
  });
}
