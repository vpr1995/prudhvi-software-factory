import { z } from 'zod';

import { SchemaRegistry } from './registry.js';

const MAX_TITLE_LENGTH = 120;
const MAX_BODY_LENGTH = 2000;

/** A note. */
export const NoteSchema = z
  .object({
    id: z.uuid(),
    title: z.string().min(1).max(MAX_TITLE_LENGTH),
    body: z.string().max(MAX_BODY_LENGTH),
    createdAt: z.iso.datetime(),
  })
  .register(SchemaRegistry, { id: 'Note' });

/** A note. */
export type Note = z.infer<typeof NoteSchema>;

/** Request body of `POST /v1/notes`. */
export const CreateNoteSchema = z
  .strictObject({
    title: z.string().trim().min(1).max(MAX_TITLE_LENGTH),
    body: z.string().max(MAX_BODY_LENGTH).default(''),
  })
  .register(SchemaRegistry, { id: 'CreateNote' });

/** Request body of `POST /v1/notes`. */
export type CreateNote = z.infer<typeof CreateNoteSchema>;

/** Response of `GET /v1/notes`. */
export const ListNotesResponseSchema = z
  .object({
    notes: z.array(NoteSchema),
  })
  .register(SchemaRegistry, { id: 'ListNotesResponse' });

/** Response of `GET /v1/notes`. */
export type ListNotesResponse = z.infer<typeof ListNotesResponseSchema>;
