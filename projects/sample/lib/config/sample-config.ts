import type { DeployEnv, PlatformEnv } from '@vprprudhvi/shared-cdk-constructs';

/** The settings of the sample stacks for one environment. No account or secret is in here. */
export type SampleConfig = {
  /** The environment name. It is the `<env>` in the stack name `SampleApi-<env>`. */
  readonly env: DeployEnv;
  /** The platform environment to read. It is the `<env>` in `/platform/<env>/...`. */
  readonly platformEnv: PlatformEnv;
  /**
   * `true` to deploy the three functions and their HTTP APIs. `false` deploys only the app client
   * and its outputs, for an API that runs on this machine.
   */
  readonly deployApis: boolean;
  /** The URLs that the hosted sign-in redirects to after sign-in. At least one. */
  readonly callbackUrls: readonly string[];
  /** The URLs that the hosted sign-in redirects to after sign-out. */
  readonly logoutUrls: readonly string[];
  /** The browser origins that may call the APIs. Empty means the APIs send no CORS headers. */
  readonly corsOrigins: readonly string[];
};
