/** A handler for the tests. CDK never runs it, because the tests do not bundle. */
export function handler(): { readonly statusCode: number } {
  return { statusCode: 200 };
}
