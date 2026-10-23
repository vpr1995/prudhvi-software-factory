import { App } from 'aws-cdk-lib';

import { addPlatformStack } from '../lib/platform-app.js';

const app = new App();
addPlatformStack(app, app.node.tryGetContext('env'));
app.synth();
