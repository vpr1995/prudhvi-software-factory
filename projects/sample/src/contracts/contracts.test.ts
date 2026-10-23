import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  CreateNoteSchema,
  ErrorEnvelopeSchema,
  HealthSchema,
  ListNotesResponseSchema,
  NoteSchema,
  ROUTES,
  SchemaRegistry,
} from './index.js';

const NOTE = {
  id: '0f1d2c3b-4a59-4687-8a9b-0c1d2e3f4a5b',
  title: 'Buy milk',
  body: '',
  createdAt: '2026-10-22T10:00:00.000Z',
};

const CAMEL_CASE_PATTERN = /^[a-z][A-Za-z0-9]*$/;
const PLACEHOLDER_PATTERN = /^\{[a-z][A-Za-z]*\}$/;
const KEBAB_PATTERN = /^[a-z-]+$/u;

function isKebabCase(segment: string): boolean {
  return (
    KEBAB_PATTERN.test(segment) &&
    !segment.startsWith('-') &&
    !segment.endsWith('-') &&
    !segment.includes('--')
  );
}

/** Checks a path: `/v1`, then kebab-case words or `{camelCase}` placeholders. */
function isVersionedKebabPath(path: string): boolean {
  const [empty, version, ...segments] = path.split('/');
  return (
    empty === '' &&
    version === 'v1' &&
    segments.length > 0 &&
    segments.every((segment) => isKebabCase(segment) || PLACEHOLDER_PATTERN.test(segment))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Collects every property name in a JSON Schema tree. */
function collectPropertyNames(node: unknown, names: Set<string>): Set<string> {
  if (!isRecord(node)) {
    return names;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 'properties' && isRecord(value)) {
      for (const name of Object.keys(value)) {
        names.add(name);
      }
    }
    collectPropertyNames(value, names);
  }
  return names;
}

async function readOpenApi(): Promise<Record<string, unknown>> {
  const text = await readFile(new URL('../../dist/openapi.json', import.meta.url), 'utf8');
  return JSON.parse(text) as Record<string, unknown>;
}

describe('schemas', () => {
  it('accepts a valid health body and rejects another status', () => {
    expect(HealthSchema.safeParse({ status: 'ok', service: 's', version: '1' }).success).toBe(true);
    expect(HealthSchema.safeParse({ status: 'down', service: 's', version: '1' }).success).toBe(
      false,
    );
  });

  it('accepts a note and a list of notes', () => {
    expect(NoteSchema.safeParse(NOTE).success).toBe(true);
    expect(ListNotesResponseSchema.parse({ notes: [NOTE] }).notes).toHaveLength(1);
  });

  it('rejects a note with a bad id or date', () => {
    expect(NoteSchema.safeParse({ ...NOTE, id: 'abc' }).success).toBe(false);
    expect(NoteSchema.safeParse({ ...NOTE, createdAt: 'yesterday' }).success).toBe(false);
  });

  it('trims the title, defaults the body, and rejects an empty title', () => {
    expect(CreateNoteSchema.parse({ title: '  Hello  ' })).toEqual({ title: 'Hello', body: '' });
    expect(CreateNoteSchema.safeParse({ title: '   ' }).success).toBe(false);
    expect(CreateNoteSchema.safeParse({ title: 'x'.repeat(121) }).success).toBe(false);
  });

  it('accepts the error envelope only with an UPPER_SNAKE code', () => {
    const error = { code: 'NOTE_NOT_FOUND', message: 'm', requestId: 'r' };
    expect(ErrorEnvelopeSchema.safeParse({ error }).success).toBe(true);
    expect(ErrorEnvelopeSchema.safeParse({ error: { ...error, code: 'notFound' } }).success).toBe(
      false,
    );
    expect(ErrorEnvelopeSchema.safeParse({ message: 'plain' }).success).toBe(false);
  });
});

type CreateNoteCase = {
  readonly name: string;
  readonly raw: string;
  readonly status: 201 | 400;
  readonly title?: string;
  readonly body?: string;
};

async function readCreateNoteCases(): Promise<CreateNoteCase[]> {
  const text = await readFile(
    new URL('./fixtures/create-note-cases.json', import.meta.url),
    'utf8',
  );
  return (JSON.parse(text) as { cases: CreateNoteCase[] }).cases;
}

/** Parses the raw request body like the TypeScript API does: JSON first, then the Zod schema. */
function parseCreateNote(raw: string): ReturnType<typeof CreateNoteSchema.safeParse> {
  try {
    return CreateNoteSchema.safeParse(JSON.parse(raw));
  } catch {
    return CreateNoteSchema.safeParse(undefined);
  }
}

describe('fixtures/create-note-cases.json (shared with api-py and api-go)', () => {
  it('matches the Zod schema, which is the reference for every API', async () => {
    const cases = await readCreateNoteCases();

    const actual = cases.map((entry) => {
      const result = parseCreateNote(entry.raw);
      return result.success
        ? { name: entry.name, status: 201, title: result.data.title, body: result.data.body }
        : { name: entry.name, status: 400 };
    });
    const expected = cases.map(({ name, status, title, body }) =>
      status === 201 ? { name, status, title, body } : { name, status },
    );

    expect(cases.length).toBeGreaterThan(10);
    expect(actual).toEqual(expected);
  });

  it('has the cases that drifted before: padded 120-character title and null body', async () => {
    const names = (await readCreateNoteCases()).map((entry) => entry.name);

    expect(names).toContain('120 characters padded with spaces');
    expect(names).toContain('null body');
  });
});

describe('routes', () => {
  it('uses kebab-case, plural, versioned paths and unique operation ids', () => {
    for (const route of ROUTES) {
      expect(isVersionedKebabPath(route.path)).toBe(true);
    }
    const operationIds = ROUTES.map((route) => route.operationId);
    expect(new Set(operationIds).size).toBe(operationIds.length);
  });

  it('registers every route schema with an id', () => {
    for (const route of ROUTES) {
      for (const schema of [route.requestBody, ...Object.values(route.responses)]) {
        if (schema !== undefined) {
          expect(SchemaRegistry.get(schema)?.id).toBeDefined();
        }
      }
    }
  });
});

describe('dist/openapi.json (written by the build)', () => {
  it('has one operation for each route', async () => {
    const document = await readOpenApi();
    const paths = document['paths'] as Record<string, Record<string, { operationId: string }>>;

    for (const route of ROUTES) {
      expect(paths[route.path]?.[route.method]?.operationId).toBe(route.operationId);
    }
    expect(document['openapi']).toBe('3.1.0');
  });

  it('names each component and strips $schema and $id', async () => {
    const document = await readOpenApi();
    const components = document['components'] as { schemas: Record<string, object> };

    expect(Object.keys(components.schemas).sort()).toEqual([
      'CreateNote',
      'ErrorEnvelope',
      'Health',
      'ListNotesResponse',
      'Note',
    ]);
    for (const schema of Object.values(components.schemas)) {
      expect(schema).not.toHaveProperty('$schema');
      expect(schema).not.toHaveProperty('$id');
    }
  });

  it('uses camelCase JSON field names', async () => {
    const names = collectPropertyNames(await readOpenApi(), new Set<string>());

    expect(names.size).toBeGreaterThan(0);
    for (const name of names) {
      expect(name).toMatch(CAMEL_CASE_PATTERN);
    }
  });
});
