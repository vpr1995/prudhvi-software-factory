import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initTelemetry, withSpan } from '@vprprudhvi/shared-telemetry';
import type { TelemetryHandle } from '@vprprudhvi/shared-telemetry';

import { createLogger, getTraceLogFields } from '../src/logger.js';
import { buildRedactPaths, isRedactedKey, keyVariants, REDACTED_TEXT } from '../src/redact.js';

const TRACE_ID_LENGTH = 32;
const SPAN_ID_LENGTH = 16;

type LogLine = Record<string, unknown>;

/** Collects log lines in memory. */
function createCollector(): { lines: LogLine[]; destination: { write: (line: string) => void } } {
  const lines: LogLine[] = [];
  return {
    lines,
    destination: {
      write: (line) => {
        lines.push(JSON.parse(line) as LogLine);
      },
    },
  };
}

let handle: TelemetryHandle;

beforeAll(() => {
  handle = initTelemetry({
    serviceName: 'logger-test',
    serviceVersion: '0.0.0',
    environment: 'test',
  });
});

afterAll(async () => {
  await handle.shutdown();
});

describe('createLogger', () => {
  it('writes JSON with a string level, an ISO time, msg and service.name', () => {
    const { lines, destination } = createCollector();
    const logger = createLogger({ serviceName: 'svc', destination });

    logger.info({ orderId: 'o-1' }, 'order exported');

    const [line] = lines;
    expect(line).toMatchObject({
      level: 'info',
      msg: 'order exported',
      orderId: 'o-1',
      'service.name': 'svc',
    });
    expect(String(line?.['time'])).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(line).not.toHaveProperty('pid');
    expect(line).not.toHaveProperty('trace_id');
  });

  it('respects the level', () => {
    const { lines, destination } = createCollector();
    const logger = createLogger({ serviceName: 'svc', level: 'warn', destination });

    logger.info('hidden');
    logger.warn('shown');

    expect(lines.map((line) => line['msg'])).toEqual(['shown']);
  });

  it('adds trace_id, span_id and trace_flags inside a span', async () => {
    const { lines, destination } = createCollector();
    const logger = createLogger({ serviceName: 'svc', destination });

    const fields = await withSpan('logger.test', () => {
      logger.info('inside');
      return getTraceLogFields();
    });

    const [line] = lines;
    expect(String(line?.['trace_id'])).toHaveLength(TRACE_ID_LENGTH);
    expect(String(line?.['span_id'])).toHaveLength(SPAN_ID_LENGTH);
    expect(line?.['trace_flags']).toBe('01');
    expect(line).toMatchObject(fields);
  });

  it('redacts secrets and personal data at several depths', () => {
    const { lines, destination } = createCollector();
    const logger = createLogger({ serviceName: 'svc', destination });

    const payload = {
      password: 'p',
      user: { email: 'a@example.com', name: 'Ada' },
      req: { headers: { authorization: 'Bearer x', cookie: 'sid=1', accept: 'json' } },
    };
    logger.info(payload, 'login');

    expect(lines[0]).toMatchObject({
      password: REDACTED_TEXT,
      user: { email: REDACTED_TEXT, name: 'Ada' },
      req: { headers: { authorization: REDACTED_TEXT, cookie: REDACTED_TEXT, accept: 'json' } },
    });
  });
});

describe('redaction of header and snake_case keys', () => {
  it('redacts hyphenated headers, snake_case tokens and API keys at several depths', () => {
    const { lines, destination } = createCollector();
    const logger = createLogger({ serviceName: 'svc', destination });

    logger.info(
      {
        res: { headers: { 'set-cookie': ['sid=1'], 'content-type': 'json' } },
        req: {
          headers: {
            'proxy-authorization': 'Basic x',
            'x-api-key': 'k',
            'X-Auth-Token': 't',
            accept: 'json',
          },
        },
        body: Object.fromEntries([
          ['access_token', 'a'],
          ['refresh_token', 'r'],
          ['client_secret', 's'],
          ['api_key', 'k2'],
        ]),
        deep: { a: { b: { 'x-api-key': 'k3' } } },
        Authorization: 'Bearer y',
      },
      'http',
    );

    expect(lines[0]).toMatchObject({
      res: { headers: { 'set-cookie': REDACTED_TEXT, 'content-type': 'json' } },
      req: {
        headers: {
          'proxy-authorization': REDACTED_TEXT,
          'x-api-key': REDACTED_TEXT,
          'X-Auth-Token': REDACTED_TEXT,
          accept: 'json',
        },
      },
      body: Object.fromEntries([
        ['access_token', REDACTED_TEXT],
        ['refresh_token', REDACTED_TEXT],
        ['client_secret', REDACTED_TEXT],
        ['api_key', REDACTED_TEXT],
      ]),
      deep: { a: { b: { 'x-api-key': REDACTED_TEXT } } },
      Authorization: REDACTED_TEXT,
    });
  });

  it('builds a logger without a pino path error for every key', () => {
    const { destination } = createCollector();

    expect(() => createLogger({ serviceName: 'svc', destination })).not.toThrow();
  });
});

describe('buildRedactPaths', () => {
  it('matches a key at the root and three levels below', () => {
    expect(buildRedactPaths(['token'])).toEqual(
      expect.arrayContaining(['token', '*.token', '*.*.token', '*.*.*.token']),
    );
  });

  it('uses the bracket form for a hyphenated key', () => {
    expect(buildRedactPaths(['setCookie'])).toContain('*.*["set-cookie"]');
    expect(buildRedactPaths(['setCookie'])).toContain('["Set-Cookie"]');
  });
});

describe('keyVariants', () => {
  it('lists the camel, lower, snake, upper, kebab and title spellings', () => {
    expect(keyVariants('accessToken')).toEqual([
      'accessToken',
      'accesstoken',
      'access_token',
      'access-token',
      'Access-Token',
    ]);
  });
});

describe('redaction ignores case and separator style', () => {
  const spellings = [
    'API_KEY',
    'ApiKey',
    'apiKey',
    'api-key',
    'Api-Key',
    'API-KEY',
    'ACCESS_TOKEN',
    'AccessToken',
    'Authorization',
    'AUTHORIZATION',
    'X-API-KEY',
    'Set-Cookie',
    'CLIENT_SECRET',
    'PASSWORD',
    'Email',
  ];

  it('redacts every spelling at the root and at nested levels', () => {
    const { lines, destination } = createCollector();
    const logger = createLogger({ serviceName: 'svc', destination });
    const flat = Object.fromEntries(spellings.map((key) => [key, 'secret-value']));

    logger.info(
      { ...flat, req: { headers: { ...flat, accept: 'json' } }, a: { b: { c: flat } } },
      'x',
    );

    const redacted = Object.fromEntries(spellings.map((key) => [key, REDACTED_TEXT]));
    expect(lines[0]).toMatchObject({
      ...redacted,
      req: { headers: { ...redacted, accept: 'json' } },
      a: { b: { c: redacted } },
    });
    expect(JSON.stringify(lines[0])).not.toContain('secret-value');
  });

  it('keeps keys that only look similar', () => {
    const { lines, destination } = createCollector();
    const logger = createLogger({ serviceName: 'svc', destination });

    logger.info({ tokenCount: 3, KEYBOARD: 'k', user: { keyId: 'id' } }, 'x');

    expect(lines[0]).toMatchObject({ tokenCount: 3, KEYBOARD: 'k', user: { keyId: 'id' } });
  });

  it('tells a secret key apart from other keys', () => {
    expect(isRedactedKey('API_KEY')).toBe(true);
    expect(isRedactedKey('x-amz-security-token')).toBe(true);
    expect(isRedactedKey('accept')).toBe(false);
  });
});
