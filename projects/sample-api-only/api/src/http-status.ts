/** HTTP status codes used by the API. */
export const HttpStatus = {
  Ok: 200,
  Created: 201,
  BadRequest: 400,
  NotFound: 404,
  Conflict: 409,
  InternalServerError: 500,
} as const;
