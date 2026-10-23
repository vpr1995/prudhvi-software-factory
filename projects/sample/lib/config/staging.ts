import type { SampleConfig } from './sample-config.js';

// The `.invalid` host name is reserved (RFC 2606) and nobody can register it. It marks the place of
// the web URL until the web part has a deployed site.
/** The settings of the `staging` stack. */
export const stagingConfig: SampleConfig = {
  env: 'staging',
  callbackUrls: ['https://staging.sample.invalid/auth/callback'],
  logoutUrls: ['https://staging.sample.invalid'],
  corsOrigins: [],
};
