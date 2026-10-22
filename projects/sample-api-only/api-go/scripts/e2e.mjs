// _phase:e2e for api-go. It starts the built binary (bin/sample-api-only-api) on a free port, runs the
// Bruno collection of the project against it, stops the server, and exits with the exit code of `bru`.
import { spawn } from 'node:child_process';
import { get } from 'node:http';
import { createServer } from 'node:net';
import { env, exit } from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, URL } from 'node:url';

const HOST = '127.0.0.1';
const READY_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 200;
const PREFIX = 'SAMPLE_API_ONLY_API_GO_';

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

function isHealthy(baseUrl) {
  return new Promise((resolve) => {
    const request = get(`${baseUrl}/v1/health`, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.on('error', () => {
      resolve(false);
    });
  });
}

async function waitUntilReady(baseUrl, server) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`The server stopped early with exit code ${String(server.exitCode)}.`);
    }
    if (await isHealthy(baseUrl)) {
      return;
    }
    await delay(POLL_INTERVAL_MS);
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
  const server = spawn('bin/sample-api-only-api', [], {
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
