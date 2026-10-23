// Runs one Rush phase for every part of this project: node scripts/phase.mjs <phase>.
// Each part is a step. The steps run one after the other. The first step that fails stops the
// phase, and the message names the part.
import { spawn } from 'node:child_process';
import { argv, env, exit, stderr, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

const PROJECT_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));

// The drift checks of the generated Python models and Go types read dist/openapi.json. The lint
// and typecheck phases do not wait for the build phase of this project, so the drift checks run in
// the test phase, which does.
const PHASES = {
  build: [
    {
      part: 'typescript (src/contracts, src/api) and dist/openapi.json',
      command: 'tsc -p tsconfig.build.json && node scripts/emit-openapi.mjs > dist/openapi.json',
    },
    {
      part: 'python (src/api-py)',
      directory: 'src/api-py',
      command: 'uv run --locked python -m compileall -q src',
    },
    {
      part: 'go (src/api-go)',
      directory: 'src/api-go',
      command: 'go build -o ../../dist/api-go/sample-api ./cmd/sample-api',
    },
    { part: 'web', directory: 'web', command: 'next build' },
  ],
  lint: [
    { part: 'typescript and web (eslint)', command: 'eslint --max-warnings 0 .' },
    { part: 'python (src/api-py)', directory: 'src/api-py', command: 'bash scripts/lint.sh' },
    { part: 'go (src/api-go)', directory: 'src/api-go', command: 'bash scripts/lint.sh' },
  ],
  typecheck: [
    { part: 'typescript (src, vitest config)', command: 'tsc -p tsconfig.json --noEmit' },
    {
      part: 'web',
      directory: 'web',
      command: 'next typegen && tsc -p tsconfig.json --noEmit',
    },
    { part: 'python (src/api-py)', directory: 'src/api-py', command: 'uv run --locked mypy' },
    {
      part: 'go (src/api-go)',
      directory: 'src/api-go',
      command: 'go vet ./... && go build ./...',
    },
  ],
  test: [
    {
      part: 'python models drift check',
      directory: 'src/api-py',
      command: 'bash scripts/generate-models.sh --check',
    },
    {
      part: 'go types drift check',
      directory: 'src/api-go',
      command: 'bash scripts/generate-types.sh --check',
    },
    { part: 'typescript and web (vitest)', command: 'vitest run --coverage' },
    { part: 'python (src/api-py)', directory: 'src/api-py', command: 'uv run --locked pytest' },
    { part: 'go (src/api-go)', directory: 'src/api-go', command: 'bash scripts/test.sh' },
  ],
  e2e: [
    { part: 'bruno against the TypeScript api', command: 'node scripts/e2e.mjs api' },
    {
      part: 'bruno against the Python api',
      command: 'uv sync --locked --quiet --project src/api-py && node scripts/e2e.mjs api-py',
    },
    { part: 'bruno against the Go api', command: 'node scripts/e2e.mjs api-go' },
    {
      part: 'playwright against the web app',
      command: 'playwright install chromium && playwright test',
    },
  ],
};

/**
 * Runs one shell command and resolves with its exit code.
 *
 * @param {{ directory?: string, command: string }} step - The step.
 * @returns {Promise<number>} The exit code.
 */
function runStep({ directory = '.', command }) {
  return new Promise((resolve) => {
    const child = spawn('bash', ['-c', command], {
      cwd: `${PROJECT_DIRECTORY}${directory}`,
      env: { ...env, PATH: `${PROJECT_DIRECTORY}node_modules/.bin:${env['PATH'] ?? ''}` },
      stdio: 'inherit',
    });
    child.on('error', () => {
      resolve(1);
    });
    child.on('close', (code) => {
      resolve(code ?? 1);
    });
  });
}

async function main() {
  const name = argv[2] ?? '';
  const steps = Object.hasOwn(PHASES, name) ? PHASES[name] : undefined;
  if (steps === undefined) {
    stderr.write(`Unknown phase "${name}". Use one of: ${Object.keys(PHASES).join(', ')}.\n`);
    return 2;
  }
  for (const step of steps) {
    stdout.write(`\n[${name}] ${step.part}\n`);
    const code = await runStep(step);
    if (code !== 0) {
      stderr.write(`\n[${name}] FAILED in part "${step.part}" (exit code ${String(code)}).\n`);
      return code;
    }
  }
  stdout.write(`\n[${name}] all ${String(steps.length)} parts passed.\n`);
  return 0;
}

exit(await main());
