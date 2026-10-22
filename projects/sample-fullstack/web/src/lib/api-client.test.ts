import { describe, expect, it, vi } from 'vitest';

import { ApiClientError, createApiClient } from './api-client';
import type { FetchFunction } from './api-client';

const NOTE = {
  id: '3f1b9a52-7d0e-4c1a-9b53-2a6f0e5d8c11',
  title: 'Plan',
  body: '',
  createdAt: '2026-01-02T03:04:05.000Z',
};
const BASE_URL = 'http://api.test';
const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeClient(fetchMock: FetchFunction, getHeaders?: () => Record<string, string>) {
  return createApiClient({
    baseUrl: BASE_URL,
    fetch: fetchMock,
    ...(getHeaders === undefined ? {} : { getHeaders }),
  });
}

describe('listNotes', () => {
  it('returns the notes and sends a GET with the extra headers', async () => {
    const fetchMock = vi.fn<FetchFunction>().mockResolvedValue(jsonResponse({ notes: [NOTE] }));
    const result = await makeClient(fetchMock, () => ({ traceparent: 'x' })).listNotes();

    expect(result).toEqual({ ok: true, value: [NOTE] });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('http://api.test/v1/notes');
    expect(init?.method).toBe('GET');
    expect(init?.headers).toMatchObject({ accept: 'application/json', traceparent: 'x' });
  });

  it('fails with API_BAD_RESPONSE when the answer does not match the contract', async () => {
    const fetchMock = vi
      .fn<FetchFunction>()
      .mockResolvedValue(jsonResponse({ notes: [{ id: 1 }] }));
    const result = await makeClient(fetchMock).listNotes();
    expect(!result.ok && result.error.code).toBe('API_BAD_RESPONSE');
  });

  it('fails with API_UNREACHABLE when the request throws', async () => {
    const fetchMock = vi.fn<FetchFunction>().mockRejectedValue(new TypeError('network down'));
    const result = await makeClient(fetchMock).listNotes();
    expect(!result.ok && result.error).toBeInstanceOf(ApiClientError);
    expect(!result.ok && result.error.code).toBe('API_UNREACHABLE');
    expect(!result.ok && result.error.cause).toBeInstanceOf(TypeError);
  });

  it('fails with API_ERROR when an error answer has no envelope', async () => {
    const fetchMock = vi
      .fn<FetchFunction>()
      .mockResolvedValue(new Response('boom', { status: 502 }));
    const result = await makeClient(fetchMock).listNotes();
    expect(!result.ok && result.error).toMatchObject({ code: 'API_ERROR', status: 502 });
  });

  it('uses the global fetch when no fetch is given', async () => {
    const globalFetch = vi.fn().mockResolvedValue(jsonResponse({ notes: [] }));
    vi.stubGlobal('fetch', globalFetch);
    const result = await createApiClient({ baseUrl: BASE_URL }).listNotes();
    expect(result).toEqual({ ok: true, value: [] });
    expect(globalFetch).toHaveBeenCalledOnce();
  });
});

describe('createNote', () => {
  it('sends the body as JSON and returns the note', async () => {
    const fetchMock = vi.fn<FetchFunction>().mockResolvedValue(jsonResponse(NOTE, 201));
    const result = await makeClient(fetchMock).createNote({ title: 'Plan' });

    expect(result).toEqual({ ok: true, value: NOTE });
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('{"title":"Plan"}');
    expect(init?.headers).toMatchObject({ 'content-type': 'application/json' });
  });

  it('returns the error envelope of the API as a typed error', async () => {
    const envelope = {
      error: {
        code: 'NOTE_TITLE_TAKEN',
        message: 'A note with this title exists.',
        requestId: TRACE_ID,
      },
    };
    const fetchMock = vi.fn<FetchFunction>().mockResolvedValue(jsonResponse(envelope, 409));
    const result = await makeClient(fetchMock).createNote({ title: 'Plan' });
    expect(!result.ok && result.error).toMatchObject({
      code: 'NOTE_TITLE_TAKEN',
      message: 'A note with this title exists.',
      status: 409,
      requestId: TRACE_ID,
    });
  });

  it('maps an envelope code that is not upper case to API_ERROR', async () => {
    const envelope = { error: { code: 'Weird', message: 'x', requestId: 'r' } };
    const fetchMock = vi.fn<FetchFunction>().mockResolvedValue(jsonResponse(envelope, 400));
    const result = await makeClient(fetchMock).createNote({ title: 'Plan' });
    expect(!result.ok && result.error.code).toBe('API_ERROR');
  });
});
