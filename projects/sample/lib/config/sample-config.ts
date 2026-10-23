import type { PlatformEnv } from '@vprprudhvi/shared-cdk-constructs';

/** The settings of the sample stacks for one environment. No account or secret is in here. */
export type SampleConfig = {
  /** The environment name. It is the `<env>` in `/platform/<env>/...`. */
  readonly env: PlatformEnv;
  /** The URLs that the hosted sign-in redirects to after sign-in. At least one. */
  readonly callbackUrls: readonly string[];
  /** The URLs that the hosted sign-in redirects to after sign-out. */
  readonly logoutUrls: readonly string[];
  /** The browser origins that may call the APIs. Empty means the APIs send no CORS headers. */
  readonly corsOrigins: readonly string[];
};
