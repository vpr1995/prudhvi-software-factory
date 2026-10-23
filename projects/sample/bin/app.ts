import { App } from 'aws-cdk-lib';

import { addSampleApiStack } from '../lib/sample-app.js';

const app = new App();
addSampleApiStack(app, app.node.tryGetContext('env'));
app.synth();
