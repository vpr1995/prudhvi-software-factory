// Prints the OpenAPI 3.1 document of this API to standard output. The build redirects it to dist/openapi.json.
// Python and Go models are generated from that file. It reads only built output, so run it after `tsc`.
import { z } from 'zod';

import { ROUTES, SchemaRegistry } from '../dist/contracts/index.js';

const SCHEMA_REF_PREFIX = '#/components/schemas/';
const JSON_CONTENT_TYPE = 'application/json';
const INDENT = 2;

/**
 * Points at a named schema.
 *
 * @param {import('zod').ZodType} schema - A schema that is in the registry.
 * @returns {{ $ref: string }} A JSON reference.
 */
function refTo(schema) {
  const id = SchemaRegistry.get(schema)?.id;
  if (id === undefined) {
    throw new Error(
      'Register the schema in SchemaRegistry with an id before you use it in a route.',
    );
  }
  return { $ref: `${SCHEMA_REF_PREFIX}${id}` };
}

/**
 * Builds the OpenAPI operation object of a route.
 *
 * @param {import('../dist/contracts/index.js').ApiRoute} route - The route.
 * @returns {Record<string, unknown>} The operation.
 */
function buildOperation(route) {
  return {
    operationId: route.operationId,
    summary: route.summary,
    tags: [route.tag],
    ...(route.requestBody === undefined
      ? {}
      : {
          requestBody: {
            required: true,
            content: { [JSON_CONTENT_TYPE]: { schema: refTo(route.requestBody) } },
          },
        }),
    responses: Object.fromEntries(
      Object.entries(route.responses).map(([status, schema]) => [
        status,
        {
          description: `Response ${status}`,
          content: { [JSON_CONTENT_TYPE]: { schema: refTo(schema) } },
        },
      ]),
    ),
  };
}

const generated = z.toJSONSchema(SchemaRegistry, {
  io: 'input',
  uri: (id) => `${SCHEMA_REF_PREFIX}${id}`,
});

// OpenAPI components must not carry `$schema` or `$id`. Code generators reject the fragment-only `$id`.
const schemas = structuredClone(generated.schemas);
for (const schema of Object.values(schemas)) {
  Reflect.deleteProperty(schema, '$schema');
  Reflect.deleteProperty(schema, '$id');
}

/** @type {Record<string, Record<string, unknown>>} */
const paths = {};
for (const route of ROUTES) {
  paths[route.path] = { ...paths[route.path], [route.method]: buildOperation(route) };
}

const document = {
  openapi: '3.1.0',
  info: { title: 'sample API', version: '1.0.0' },
  paths,
  components: { schemas },
};

process.stdout.write(`${JSON.stringify(document, null, INDENT)}\n`);
