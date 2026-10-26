import { App } from 'aws-cdk-lib';

import { addNationalParksTrackerStack } from '../lib/national-parks-tracker-app.js';

const app = new App();
addNationalParksTrackerStack(app);
app.synth();
