// Runs one Rush phase for every part of this project: node scripts/phase.mjs <phase>.
// Each part is a step. The steps run one after the other. The first step that fails stops the
// phase, and the message names the part.
import { spawn } from 'node:child_process';
import { argv, env, exit, stderr, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

const PROJECT_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));

const PHASES = {
  build: [
    {
      part: 'typescript (src/contracts, src/api) and dist/openapi.json',
      command: 'tsc -p tsconfig.build.json && node scripts/emit-openapi.mjs > dist/openapi.json',
    },
    { part: 'web', directory: 'web', command: 'next build' },
  ],
  lint: [{ part: 'typescript and web (eslint)', command: 'eslint --max-warnings 0 .' }],
  typecheck: [
    { part: 'typescript (src, vitest config)', command: 'tsc -p tsconfig.json --noEmit' },
    {
      part: 'web',
      directory: 'web',
      command: 'next typegen && tsc -p tsconfig.json --noEmit',
    },
  ],
  test: [{ part: 'typescript and web (vitest)', command: 'vitest run --coverage' }],
  e2e: [
    { part: 'bruno against the TypeScript api', command: 'node scripts/e2e.mjs api' },
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
