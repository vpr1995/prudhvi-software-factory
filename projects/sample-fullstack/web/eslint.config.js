import { base, boundaries, next, node, test } from '@vprprudhvi/tooling-eslint-config';

const REPO_ROOT = new URL('../../../', import.meta.url).pathname;

// Only @vprprudhvi/shared-telemetry may import the OpenTelemetry packages. Use its re-exports.
// A separate rule (not no-restricted-imports) keeps the shared import bans in force.
const otelGuard = {
  name: 'project/otel-import-guard',
  rules: {
    'n/no-restricted-import': [
      'error',
      [
        {
          name: ['@opentelemetry/*'],
          message:
            'Import OpenTelemetry through @vprprudhvi/shared-telemetry. Only packages/telemetry imports @opentelemetry/*.',
        },
      ],
    ],
  },
};

export default [
  ...base,
  ...node,
  ...next,
  ...test,
  ...boundaries({ rootPath: REPO_ROOT }),
  otelGuard,
];
