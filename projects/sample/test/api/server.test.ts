import { afterEach, describe, expect, it } from 'vitest';

import { createInMemoryNotesStore } from '../../src/api/adapters/notes-store.js';
import { buildServer, startServer } from '../../src/api/server.js';
import type { Server } from '../../src/api/server.js';
import { ROUTES } from '../../src/contracts/index.js';

import { makeCollectingLogger, makeTestConfig } from './support.js';

const ORIGIN = 'http://localhost:4311';
const UUID_PATTERN = /^[0-9a-f-]{36}$/;

let app: Server | undefined;

async function makeApp(source: Record<string, string> = {}): Promise<Server> {
  const { logger } = makeCollectingLogger();
  app = await buildServer({ config: makeTestConfig(source), logger });
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('GET /v1/health', () => {
  it('returns status, service and version', async () => {
    const server = await makeApp();
    const response = await server.inject({ method: 'GET', url: '/v1/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      service: 'sample-api',
      version: '9.9.9',
    });
  });
});

describe('security headers', () => {
  it('sets the helmet headers on a success response', async () => {
    const server = await makeApp();
    const response = await server.inject({ method: 'GET', url: '/v1/health' });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
    expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(response.headers['strict-transport-security']).toBeDefined();
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('sets them on an error response too', async () => {
    const server = await makeApp();
    const response = await server.inject({ method: 'GET', url: '/missing' });
    expect(response.statusCode).toBe(404);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('notes', () => {
  it('lists no notes at first', async () => {
    const server = await makeApp();
    const response = await server.inject({ method: 'GET', url: '/v1/notes' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ notes: [] });
  });

  it('creates a note and lists it', async () => {
    const server = await makeApp();
    const created = await server.inject({
      method: 'POST',
      url: '/v1/notes',
      payload: { title: '  First  ', body: 'Hello' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ title: 'First', body: 'Hello' });
    expect(created.json<{ id: string }>().id).toMatch(UUID_PATTERN);

    const listed = await server.inject({ method: 'GET', url: '/v1/notes' });
    expect(listed.json<{ notes: unknown[] }>().notes).toHaveLength(1);
  });

  it('defaults the body to an empty string', async () => {
    const server = await makeApp();
    const created = await server.inject({
      method: 'POST',
      url: '/v1/notes',
      payload: { title: 'Bare' },
    });
    expect(created.json()).toMatchObject({ body: '' });
  });

  it('returns 400 with the envelope for an invalid body (requestId falls back to the request id without telemetry)', async () => {
    const server = await makeApp();
    const response = await server.inject({
      method: 'POST',
      url: '/v1/notes',
      payload: { title: '' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'The request is not valid.',
        requestId: 'req-1',
      },
    });
  });

  it('returns 400 for an unknown key in the body', async () => {
    const server = await makeApp();
    const response = await server.inject({
      method: 'POST',
      url: '/v1/notes',
      payload: { title: 'Extra', isAdmin: true },
    });
    expect(response.statusCode).toBe(400);
  });

  it('returns 400 for a body that is not JSON', async () => {
    const server = await makeApp();
    const response = await server.inject({
      method: 'POST',
      url: '/v1/notes',
      headers: { 'content-type': 'application/json' },
      payload: '{not json',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('BAD_REQUEST');
  });

  it('returns 409 for a duplicate title', async () => {
    const server = await makeApp();
    await server.inject({ method: 'POST', url: '/v1/notes', payload: { title: 'Same' } });
    const response = await server.inject({
      method: 'POST',
      url: '/v1/notes',
      payload: { title: 'same' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('NOTE_TITLE_TAKEN');
  });

  it('returns 500 with the envelope when the store fails, without leaking the cause', async () => {
    const { logger } = makeCollectingLogger();
    const store = {
      ...createInMemoryNotesStore(),
      list: () => Promise.reject(new Error('database password is hunter2')),
    };
    app = await buildServer({ config: makeTestConfig(), logger, notesStore: store });
    const response = await app.inject({ method: 'GET', url: '/v1/notes' });
    expect(response.statusCode).toBe(500);
    expect(response.json<{ error: { code: string; message: string } }>().error).toMatchObject({
      code: 'INTERNAL_ERROR',
    });
    expect(response.body).not.toContain('hunter2');
  });
});

describe('unknown route', () => {
  it('returns 404 with the envelope', async () => {
    const server = await makeApp();
    const response = await server.inject({ method: 'GET', url: '/v1/nothing' });
    expect(response.statusCode).toBe(404);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('NOT_FOUND');
  });
});

describe('contract', () => {
  it('serves every route of the contracts package', async () => {
    const server = await makeApp();
    for (const route of ROUTES) {
      const method = route.method === 'get' ? 'GET' : 'POST';
      expect(server.hasRoute({ method, url: route.path }), `${method} ${route.path}`).toBe(true);
    }
  });

  it('serves no route that the contracts package lacks', async () => {
    const server = await makeApp();
    const documented = ROUTES.map((route) => `${route.method.toUpperCase()} ${route.path}`);
    const served = server
      .printRoutes({ commonPrefix: false, includeMeta: false })
      .split('\n')
      .filter((line) => line.includes('('));
    // Each line of the tree has the form `notes (GET, HEAD, POST)`; HEAD comes with GET.
    const methodCount = served
      .flatMap((line) => (/\(([^)]*)\)/.exec(line)?.[1] ?? '').split(', '))
      .filter((method) => method !== 'HEAD').length;
    expect(methodCount).toBe(documented.length);
  });
});

describe('CORS', () => {
  it('sets no CORS headers when no origin is configured', async () => {
    const server = await makeApp();
    const response = await server.inject({
      method: 'GET',
      url: '/v1/health',
      headers: { origin: ORIGIN },
    });
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows the trace headers for a configured origin', async () => {
    const server = await makeApp({ SAMPLE_API_CORS_ORIGINS: ORIGIN });
    const response = await server.inject({
      method: 'OPTIONS',
      url: '/v1/notes',
      headers: {
        origin: ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,traceparent',
      },
    });
    expect(response.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(response.headers['access-control-allow-headers']).toContain('traceparent');

    const simple = await server.inject({
      method: 'GET',
      url: '/v1/health',
      headers: { origin: ORIGIN },
    });
    expect(simple.headers['access-control-expose-headers']).toContain('traceparent');
  });
});

describe('startServer', () => {
  it('listens on the configured port', async () => {
    const { logger } = makeCollectingLogger();
    const config = makeTestConfig({ SAMPLE_API_PORT: '0' });
    const running = await startServer({ config, logger });
    try {
      const address = running.server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      const response = await fetch(`http://127.0.0.1:${String(port)}/v1/health`);
      expect(response.status).toBe(200);
    } finally {
      await running.close();
    }
  });
});
