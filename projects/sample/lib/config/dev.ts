import type { SampleConfig } from './sample-config.js';

/** The settings of the `dev` stack. The web app runs on this machine. */
export const developmentConfig: SampleConfig = {
  env: 'dev',
  callbackUrls: ['http://localhost:3000/auth/callback'],
  logoutUrls: ['http://localhost:3000'],
  corsOrigins: ['http://localhost:3000'],
};
