import type { PlatformEnv } from '@vprprudhvi/shared-cdk-constructs';

/** The settings of the platform stack for one environment. No account or secret is in here. */
export type PlatformConfig = {
  /** The environment name. It is the `<env>` in `/platform/<env>/...`. */
  readonly env: PlatformEnv;
  /**
   * The start of the Cognito hosted sign-in domain. The domain is `<domainPrefix>-<env>`. The
   * prefix must be unique in the region and must not have `aws`, `amazon` or `cognito` in it.
   */
  readonly domainPrefix: string;
};
