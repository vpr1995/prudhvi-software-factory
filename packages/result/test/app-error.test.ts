import { describe, expect, it } from 'vitest';

import { AppError, isErrorCode } from '../src/app-error.js';

class UserNotFoundError extends AppError {
  readonly code = 'USER_NOT_FOUND';
}

describe('AppError', () => {
  it('keeps the code, message, name and cause', () => {
    const cause = new Error('db down');
    const error = new UserNotFoundError('user 1 is missing', { cause });

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('USER_NOT_FOUND');
    expect(error.message).toBe('user 1 is missing');
    expect(error.name).toBe('UserNotFoundError');
    expect(error.cause).toBe(cause);
  });

  it('accepts only UPPER_SNAKE_CASE codes', () => {
    expect(isErrorCode('USER_NOT_FOUND')).toBe(true);
    expect(isErrorCode('E404')).toBe(true);
    expect(isErrorCode('userNotFound')).toBe(false);
    expect(isErrorCode('USER__NOT')).toBe(false);
    expect(isErrorCode('')).toBe(false);
  });
});
