// Bruno e2e for one API of this project: node scripts/e2e.mjs <api|api-py|api-go>.
// It starts the built server on a free port, runs the Bruno collection in bruno/ against it,
// stops the server, and exits with the exit code of `bru`. The same collection runs against the
// TypeScript, the Python and the Go API.
import { spawn } from 'node:child_process';
import { get } from 'node:http';
import { createServer } from 'node:net';
import { argv, env, exit, stderr } from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, URL } from 'node:url';

const HOST = '127.0.0.1';
const READY_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 200;

const projectDirectory = fileURLToPath(new URL('..', import.meta.url));
const collectionDirectory = `${projectDirectory}bruno`;

const SERVERS = {
  api: {
    prefix: 'SAMPLE_API_',
    logLevel: 'warn',
    directory: '.',
    command: 'node',
    args: ['dist/api/main.js'],
  },
  'api-py': {
    prefix: 'SAMPLE_API_PY_',
    logLevel: 'WARNING',
    directory: 'src/api-py',
    command: '.venv/bin/python',
    args: ['-m', 'sample_api'],
  },
  'api-go': {
    prefix: 'SAMPLE_API_GO_',
    logLevel: 'warn',
    directory: '.',
    command: 'dist/api-go/sample-api',
    args: [],
  },
};

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
      env: { ...env, PATH: `${projectDirectory}node_modules/.bin:${env['PATH'] ?? ''}` },
      stdio: 'inherit',
    });
    bru.on('close', (code) => {
      resolve(code ?? 1);
    });
  });
}

async function main() {
  const name = argv[2] ?? '';
  const target = Object.hasOwn(SERVERS, name) ? SERVERS[name] : undefined;
  if (target === undefined) {
    stderr.write(`Unknown api "${name}". Use one of: ${Object.keys(SERVERS).join(', ')}.\n`);
    return 2;
  }
  const port = await findFreePort();
  const baseUrl = `http://${HOST}:${String(port)}`;
  const server = spawn(target.command, target.args, {
    cwd: `${projectDirectory}${target.directory}`,
    env: {
      ...env,
      [`${target.prefix}PORT`]: String(port),
      [`${target.prefix}HOST`]: HOST,
      [`${target.prefix}LOG_LEVEL`]: target.logLevel,
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
