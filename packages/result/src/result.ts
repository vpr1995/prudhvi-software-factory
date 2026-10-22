/** A successful outcome that carries a value. */
export type Ok<TValue> = {
  readonly ok: true;
  readonly value: TValue;
};

/** A failed outcome that carries an error. Named `Fail` because the shared ESLint config bans the abbreviation `err`. */
export type Fail<TError> = {
  readonly ok: false;
  readonly error: TError;
};

/** The outcome of an operation that can fail without a bug. Domain functions return it. */
export type Result<TValue, TError> = Ok<TValue> | Fail<TError>;

/**
 * Wraps a value in a successful result.
 *
 * @param value - The value to return.
 * @returns An `Ok` result.
 */
export function ok<TValue>(value: TValue): Ok<TValue> {
  return { ok: true, value };
}

/**
 * Wraps an error in a failed result.
 *
 * @param error - The error to return.
 * @returns An `Fail` result.
 */
export function fail<TError>(error: TError): Fail<TError> {
  return { ok: false, error };
}

/**
 * Narrows a result to `Ok`.
 *
 * @param result - The result to check.
 * @returns `true` when the result holds a value.
 */
export function isOk<TValue, TError>(result: Result<TValue, TError>): result is Ok<TValue> {
  return result.ok;
}

/**
 * Narrows a result to `Fail`.
 *
 * @param result - The result to check.
 * @returns `true` when the result holds an error.
 */
export function isFail<TValue, TError>(result: Result<TValue, TError>): result is Fail<TError> {
  return !result.ok;
}

/**
 * Transforms the value of a successful result. A failed result passes through.
 *
 * @param result - The result to transform.
 * @param transform - Maps the value to a new value.
 * @returns A new result.
 */
export function map<TValue, TError, TNext>(
  result: Result<TValue, TError>,
  transform: (value: TValue) => TNext,
): Result<TNext, TError> {
  return result.ok ? ok(transform(result.value)) : result;
}

/**
 * Transforms the error of a failed result. A successful result passes through.
 *
 * @param result - The result to transform.
 * @param transform - Maps the error to a new error.
 * @returns A new result.
 */
export function mapError<TValue, TError, TNext>(
  result: Result<TValue, TError>,
  transform: (error: TError) => TNext,
): Result<TValue, TNext> {
  return result.ok ? result : fail(transform(result.error));
}

/**
 * Chains an operation that can fail after a successful result.
 *
 * @param result - The first result.
 * @param next - Runs with the value and returns the next result.
 * @returns The next result, or the first error.
 */
export function andThen<TValue, TError, TNext, TNextError>(
  result: Result<TValue, TError>,
  next: (value: TValue) => Result<TNext, TNextError>,
): Result<TNext, TError | TNextError> {
  return result.ok ? next(result.value) : result;
}

/**
 * Reads the value of a result, or a fallback when the result failed.
 *
 * @param result - The result to read.
 * @param fallback - The value to return for a failed result.
 * @returns The value or the fallback.
 */
export function unwrapOr<TValue, TError>(result: Result<TValue, TError>, fallback: TValue): TValue {
  return result.ok ? result.value : fallback;
}
