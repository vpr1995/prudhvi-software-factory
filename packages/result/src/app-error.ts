/** An error code in UPPER_SNAKE_CASE, for example `USER_NOT_FOUND`. */
export type ErrorCode = Uppercase<string>;

const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;

/**
 * Checks that a string is a valid error code (UPPER_SNAKE_CASE).
 *
 * @param code - The string to check.
 * @returns `true` when the string is a valid code.
 */
export function isErrorCode(code: string): boolean {
  return ERROR_CODE_PATTERN.test(code) && !code.includes('__') && !code.endsWith('_');
}

/**
 * Base class for expected errors. Each subclass sets a `code` in UPPER_SNAKE_CASE.
 *
 * @example
 * class UserNotFoundError extends AppError {
 *   readonly code = 'USER_NOT_FOUND';
 * }
 */
export abstract class AppError extends Error {
  /** A stable machine-readable code. The API puts it in the error envelope. */
  abstract readonly code: ErrorCode;

  /**
   * Creates the error.
   *
   * @param message - A short message for people. Contains no secrets or personal data.
   * @param options - The standard `cause` option.
   */
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}
