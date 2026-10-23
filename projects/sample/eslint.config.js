import { base, boundaries, next, node, scope, test } from '@vprprudhvi/tooling-eslint-config';

const REPO_ROOT = new URL('../../', import.meta.url).pathname;

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

// One config for the whole package. Each folder gets the shared config of its kind:
// web/** gets `next` (and `node` for the server files), everything else gets `node`.
export default [
  // The Python and Go parts have their own tools (ruff, mypy, golangci-lint). They hold no
  // JavaScript that this config must check. The .venv folder holds installed Python packages.
  { name: 'project/ignore-other-languages', ignores: ['src/api-py/**', 'src/api-go/**'] },
  ...base,
  ...node,
  ...scope(['web/**'], next),
  ...test,
  ...boundaries({ rootPath: REPO_ROOT }),
  otelGuard,
];
