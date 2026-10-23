import type { z } from 'zod';

import { ErrorEnvelopeSchema } from './error.ts';
import { HealthSchema } from './health.ts';
import { CreateNoteSchema, ListNotesResponseSchema, NoteSchema } from './note.ts';

/** One API route. The OpenAPI build and the contract tests read this table. */
export type ApiRoute = {
  /** A stable name, for example `listNotes`. Generated clients use it. */
  readonly operationId: string;
  readonly method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  /** The path with `{param}` placeholders. Kebab-case, plural, versioned. */
  readonly path: string;
  readonly summary: string;
  /** The resource name. */
  readonly tag: string;
  /** The request body schema, if the route has one. */
  readonly requestBody?: z.ZodType;
  /** Response schemas by status code. */
  readonly responses: Readonly<Record<string, z.ZodType>>;
};

/** Every route of the API. Add a route here first, then implement it. */
export const ROUTES: readonly ApiRoute[] = [
  {
    operationId: 'getHealth',
    method: 'get',
    path: '/v1/health',
    summary: 'Check that the service is up.',
    tag: 'health',
    responses: { '200': HealthSchema },
  },
  {
    operationId: 'listNotes',
    method: 'get',
    path: '/v1/notes',
    summary: 'List all notes, oldest first.',
    tag: 'notes',
    responses: { '200': ListNotesResponseSchema },
  },
  {
    operationId: 'createNote',
    method: 'post',
    path: '/v1/notes',
    summary: 'Create a note.',
    tag: 'notes',
    requestBody: CreateNoteSchema,
    responses: {
      '201': NoteSchema,
      '400': ErrorEnvelopeSchema,
      '409': ErrorEnvelopeSchema,
    },
  },
];
