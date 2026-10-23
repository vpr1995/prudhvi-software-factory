import { Validations } from 'aws-cdk-lib';
import type { UserPool } from 'aws-cdk-lib/aws-cognito';

/**
 * The one file with the cdk-nag acknowledgments of `PlatformStack`. The repo owner approves each
 * entry. Add an entry only with the owner's decision, and write the reason and the date.
 *
 * @param userPool - The platform user pool. Both findings are on this resource.
 */
export function acknowledgePlatformStack(userPool: UserPool): void {
  Validations.of(userPool).acknowledge({
    id: 'AwsSolutions-COG8',
    reason:
      'The pool stays on the ESSENTIALS feature plan for cost. ESSENTIALS has a free tier. ' +
      'Revisit the PLUS plan (threat protection) when there are real users. Owner approved 2026-10-22.',
  });
  Validations.of(userPool).acknowledge({
    id: 'AwsSolutions-COG2',
    reason:
      'MFA stays optional (authenticator app). Required MFA does not apply to Google sign-ins. ' +
      'Google users use Google 2-step verification. Owner approved 2026-10-22.',
  });
}
