import type { SampleConfig } from './sample-config.js';

// The `.invalid` host name is reserved (RFC 2606) and nobody can register it. It marks the place of
// the web URL until the web part has a deployed site.
/** The settings of the `prod` stack. */
export const productionConfig: SampleConfig = {
  env: 'prod',
  callbackUrls: ['https://sample.invalid/auth/callback'],
  logoutUrls: ['https://sample.invalid'],
  corsOrigins: [],
};
