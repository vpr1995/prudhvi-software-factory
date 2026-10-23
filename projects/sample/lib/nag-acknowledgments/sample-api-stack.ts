import { Validations } from 'aws-cdk-lib';

import type { TracedHttpApi } from '@vprprudhvi/shared-cdk-constructs';

/** The reason of the `AwsSolutions-APIG4` acknowledgment. The repo owner approved it. */
export const APIG4_REASON = 'health check for uptime monitoring; returns no user data';

/**
 * The one file with the cdk-nag acknowledgments of `SampleApiStack`. The repo owner approves each
 * entry. Add an entry only with the owner's decision, and write the reason.
 *
 * It acknowledges `AwsSolutions-APIG4` (no authorization) on the public routes of each API
 * (`api.publicRoutes`), and on no other route. The only public route is `GET /v1/health`. The
 * other findings that the base function construct acknowledges are in `TracedFunctionBase`.
 *
 * @param apis - The HTTP APIs of the stack.
 */
export function acknowledgeSampleApiStack(apis: readonly TracedHttpApi[]): void {
  for (const api of apis) {
    for (const entry of api.publicRoutes) {
      Validations.of(entry.route).acknowledge({ id: 'AwsSolutions-APIG4', reason: APIG4_REASON });
    }
  }
}
