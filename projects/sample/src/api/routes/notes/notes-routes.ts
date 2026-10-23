import { randomUUID } from 'node:crypto';

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { isFail } from '@vprprudhvi/shared-result';

import {
  CreateNoteSchema,
  ErrorEnvelopeSchema,
  ListNotesResponseSchema,
  NoteSchema,
} from '../../../contracts/index.js';
import type { NotesStore } from '../../adapters/notes-store.js';
import { createNote, sortNotes } from '../../domain/notes.js';
import { buildErrorEnvelope, statusForAppError } from '../../error-handler.js';
import { HttpStatus } from '../../http-status.js';

/** The route options. */
export type NotesRouteOptions = {
  readonly notesStore: NotesStore;
};

/**
 * `GET /v1/notes` and `POST /v1/notes`.
 *
 * @param app - The Fastify instance.
 * @param options - The notes store.
 */
export const notesRoutes: FastifyPluginAsyncZod<NotesRouteOptions> = async (app, options) => {
  const { notesStore } = options;

  app.get(
    '/v1/notes',
    {
      schema: {
        tags: ['notes'],
        summary: 'List all notes, oldest first.',
        response: { [HttpStatus.Ok]: ListNotesResponseSchema },
      },
    },
    async (request) => {
      const notes = sortNotes(await notesStore.list());
      request.log.info({ count: notes.length }, 'notes listed');
      return { notes };
    },
  );

  app.post(
    '/v1/notes',
    {
      schema: {
        tags: ['notes'],
        summary: 'Create a note.',
        body: CreateNoteSchema,
        response: {
          [HttpStatus.Created]: NoteSchema,
          [HttpStatus.BadRequest]: ErrorEnvelopeSchema,
          [HttpStatus.Conflict]: ErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const result = createNote(request.body, {
        existingNotes: await notesStore.list(),
        id: randomUUID(),
        now: new Date(),
      });
      if (isFail(result)) {
        request.log.info({ code: result.error.code }, 'note rejected');
        return reply
          .code(statusForAppError(result.error))
          .send(buildErrorEnvelope(request, result.error.code, result.error.message));
      }
      await notesStore.add(result.value);
      request.log.info({ noteId: result.value.id }, 'note created');
      return reply.code(HttpStatus.Created).send(result.value);
    },
  );
  await Promise.resolve();
};
