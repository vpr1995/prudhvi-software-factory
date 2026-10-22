// _phase:e2e for the API. It starts the built server on a free port, runs the Bruno collection
// against it, stops the server, and exits with the exit code of `bru`.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { env, exit } from 'node:process';
import { fileURLToPath } from 'node:url';

const HOST = '127.0.0.1';
const READY_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 200;
const PREFIX = 'SAMPLE_FULLSTACK_API_';

const apiDirectory = fileURLToPath(new URL('..', import.meta.url));
const collectionDirectory = fileURLToPath(new URL('../../bruno', import.meta.url));

function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, HOST, () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => {
        resolve(port);
      });
    });
  });
}

async function waitUntilReady(baseUrl, server) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`The server stopped early with exit code ${String(server.exitCode)}.`);
    }
    try {
      const response = await fetch(`${baseUrl}/v1/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // The server is not listening yet. Try again.
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error('The server did not become ready in time.');
}

function runBruno(baseUrl) {
  return new Promise((resolve) => {
    const bru = spawn('bru', ['run', '--env', 'local', '--env-var', `baseUrl=${baseUrl}`], {
      cwd: collectionDirectory,
      env: { ...env, PATH: `${apiDirectory}node_modules/.bin:${env['PATH'] ?? ''}` },
      stdio: 'inherit',
    });
    bru.on('close', (code) => {
      resolve(code ?? 1);
    });
  });
}

async function main() {
  const port = await findFreePort();
  const baseUrl = `http://${HOST}:${String(port)}`;
  const server = spawn('node', ['dist/main.js'], {
    cwd: apiDirectory,
    env: {
      ...env,
      [`${PREFIX}PORT`]: String(port),
      [`${PREFIX}HOST`]: HOST,
      [`${PREFIX}LOG_LEVEL`]: 'warn',
    },
    stdio: 'inherit',
  });
  try {
    await waitUntilReady(baseUrl, server);
    return await runBruno(baseUrl);
  } finally {
    server.kill('SIGTERM');
  }
}

exit(await main());
