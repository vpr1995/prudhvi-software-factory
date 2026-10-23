import type { z } from 'zod';

import { AppError, fail, ok } from '@vprprudhvi/shared-result';
import type { ErrorCode, Result } from '@vprprudhvi/shared-result';

import {
  ErrorEnvelopeSchema,
  ListNotesResponseSchema,
  NoteSchema,
} from '../../src/contracts/index.ts';
import type { CreateNoteSchema, Note } from '../../src/contracts/index.ts';

/** An error of the API client. `code` is the code of the API error envelope, or one of the client codes. */
export class ApiClientError extends AppError {
  /** The HTTP status, or `undefined` when the API did not answer. */
  readonly status: number | undefined;

  /** The `requestId` of the error envelope. It is the trace id. */
  readonly requestId: string | undefined;

  readonly code: ErrorCode;

  /**
   * Creates the error.
   *
   * @param code - The error code.
   * @param message - A short message for people.
   * @param details - The HTTP status, the request id and the cause.
   */
  constructor(
    code: ErrorCode,
    message: string,
    details: { status?: number; requestId?: string; cause?: unknown } = {},
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.code = code;
    this.status = details.status;
    this.requestId = details.requestId;
  }
}

/** The signature of `fetch` that the client needs. */
export type FetchFunction = (input: string, init?: RequestInit) => Promise<Response>;

/** Settings of `createApiClient`. */
export type ApiClientOptions = {
  /** The origin of the API, for example `http://localhost:3000`. */
  readonly baseUrl: string;
  /** The `fetch` to use. Defaults to the global `fetch`. */
  readonly fetch?: FetchFunction;
  /** Extra headers for each request, for example the trace headers. */
  readonly getHeaders?: () => Readonly<Record<string, string>>;
};

/** The body of `createNote`. */
export type CreateNoteInput = z.input<typeof CreateNoteSchema>;

/** The API client. Every method returns a `Result`, so a caller handles failure without `try`. */
export type ApiClient = {
  readonly listNotes: () => Promise<Result<readonly Note[], ApiClientError>>;
  readonly createNote: (input: CreateNoteInput) => Promise<Result<Note, ApiClientError>>;
};

type SendOptions<TSchema extends z.ZodType> = {
  readonly path: string;
  readonly schema: TSchema;
  readonly method: 'GET' | 'POST';
  readonly body?: string;
};

function isUpperCode(value: string): value is Uppercase<string> {
  return value === value.toUpperCase();
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

async function send<TSchema extends z.ZodType>(
  options: ApiClientOptions,
  request: SendOptions<TSchema>,
): Promise<Result<z.output<TSchema>, ApiClientError>> {
  const doFetch: FetchFunction = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const url = new URL(request.path, options.baseUrl).toString();
  const headers = { accept: 'application/json', ...options.getHeaders?.() };
  let response: Response;
  try {
    response = await doFetch(url, {
      method: request.method,
      cache: 'no-store',
      headers:
        request.body === undefined ? headers : { ...headers, 'content-type': 'application/json' },
      ...(request.body === undefined ? {} : { body: request.body }),
    });
  } catch (cause: unknown) {
    return fail(new ApiClientError('API_UNREACHABLE', 'The API did not answer.', { cause }));
  }

  const json = await readJson(response);
  if (!response.ok) {
    const envelope = ErrorEnvelopeSchema.safeParse(json);
    if (envelope.success) {
      const { code, message, requestId } = envelope.data.error;
      return fail(
        new ApiClientError(isUpperCode(code) ? code : 'API_ERROR', message, {
          status: response.status,
          requestId,
        }),
      );
    }
    return fail(
      new ApiClientError('API_ERROR', `The API answered with status ${String(response.status)}.`, {
        status: response.status,
      }),
    );
  }
  const parsed = request.schema.safeParse(json);
  if (!parsed.success) {
    return fail(
      new ApiClientError('API_BAD_RESPONSE', 'The API answer does not match the contract.', {
        status: response.status,
        cause: parsed.error,
      }),
    );
  }
  return ok(parsed.data);
}

/**
 * Creates the client of the notes API. It parses each answer with the schemas of the contracts package.
 *
 * @param options - The API origin and optional `fetch` and header source.
 * @returns The client.
 */
export function createApiClient(options: ApiClientOptions): ApiClient {
  return {
    listNotes: async () => {
      const result = await send(options, {
        path: '/v1/notes',
        schema: ListNotesResponseSchema,
        method: 'GET',
      });
      return result.ok ? ok(result.value.notes) : result;
    },
    createNote: (input) =>
      send(options, {
        path: '/v1/notes',
        schema: NoteSchema,
        method: 'POST',
        body: JSON.stringify(input),
      }),
  };
}
