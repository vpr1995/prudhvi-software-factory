import type { SampleConfig } from './sample-config.js';

/**
 * The settings of the `local` stack. The web app and the API run on this machine
 * (`localhost:3000`) against the cloud resources. The stack holds only the app client and its
 * outputs: no function and no HTTP API.
 */
export const localConfig: SampleConfig = {
  env: 'local',
  platformEnv: 'prod',
  deployApis: false,
  callbackUrls: ['http://localhost:3000/auth/callback'],
  logoutUrls: ['http://localhost:3000'],
  corsOrigins: [],
};
