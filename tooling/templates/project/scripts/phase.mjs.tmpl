// Runs one Rush phase for every part of this project: node scripts/phase.mjs <phase>.
// `rush add-part` adds a part as a folder. This script finds each part by its folder, so it does
// not change when a part is added. The steps run one after the other. The first step that fails
// stops the phase, and the message names the part.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { argv, env, exit, stderr, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

const PROJECT_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));

// Rush runs the phase scripts in the project folder, so the paths are relative to it.
const PARTS = {
  project: true,
  node: existsSync('src/api'),
  web: existsSync('web'),
  infra: existsSync('cdk.json'),
};

// The infra part has no step of its own: typecheck and test cover bin/ and lib/, and
// `cdk synth` builds the CDK app (cdk.json).
const STEPS = [
  { phase: 'build', part: 'node', command: 'tsc -p tsconfig.build.json' },
  { phase: 'build', part: 'web', directory: 'web', command: 'next build' },
  { phase: 'lint', part: 'project', command: 'eslint --max-warnings 0 .' },
  { phase: 'typecheck', part: 'project', command: 'tsc -p tsconfig.json --noEmit' },
  {
    phase: 'typecheck',
    part: 'web',
    directory: 'web',
    command: 'next typegen && tsc -p tsconfig.json --noEmit',
  },
  { phase: 'test', part: 'project', command: 'vitest run --coverage' },
  { phase: 'e2e', part: 'node', command: 'node scripts/e2e.mjs' },
  { phase: 'e2e', part: 'web', command: 'playwright install chromium && playwright test' },
];

const PHASES = ['build', 'lint', 'typecheck', 'test', 'e2e'];

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
  if (!PHASES.includes(name)) {
    stderr.write(`Unknown phase "${name}". Use one of: ${PHASES.join(', ')}.\n`);
    return 2;
  }
  const found = Object.keys(PARTS).filter((part) => PARTS[part]);
  stdout.write(`[${name}] parts: ${found.join(', ')}\n`);
  const steps = STEPS.filter((step) => step.phase === name && PARTS[step.part]);
  for (const step of steps) {
    stdout.write(`\n[${name}] ${step.part}: ${step.command}\n`);
    const code = await runStep(step);
    if (code !== 0) {
      stderr.write(`\n[${name}] FAILED in part "${step.part}" (exit code ${String(code)}).\n`);
      return code;
    }
  }
  stdout.write(`\n[${name}] all ${String(steps.length)} steps passed.\n`);
  return 0;
}

exit(await main());
