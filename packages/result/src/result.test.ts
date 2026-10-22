import { describe, expect, it } from 'vitest';

import { andThen, fail, isFail, isOk, map, mapError, ok, unwrapOr } from './result.js';

describe('result helpers', () => {
  it('creates ok and fail results', () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
    expect(fail('boom')).toEqual({ ok: false, error: 'boom' });
  });

  it('narrows with isOk and isFail', () => {
    expect(isOk(ok(1))).toBe(true);
    expect(isFail(ok(1))).toBe(false);
    expect(isOk(fail('boom'))).toBe(false);
    expect(isFail(fail('boom'))).toBe(true);
  });

  it('maps a value and passes an error through', () => {
    expect(map(ok(2), (value) => value * 2)).toEqual(ok(4));
    expect(map(fail('boom'), (value: number) => value * 2)).toEqual(fail('boom'));
  });

  it('maps an error and passes a value through', () => {
    expect(mapError(fail('boom'), (error) => error.length)).toEqual(fail(4));
    expect(mapError(ok(1), (error: string) => error.length)).toEqual(ok(1));
  });

  it('chains with andThen', () => {
    const half = (
      value: number,
    ): ReturnType<typeof ok<number>> | ReturnType<typeof fail<string>> =>
      value % 2 === 0 ? ok(value / 2) : fail('odd');
    expect(andThen(ok(4), half)).toEqual(ok(2));
    expect(andThen(ok(3), half)).toEqual(fail('odd'));
    expect(andThen(fail('first'), half)).toEqual(fail('first'));
  });

  it('unwraps with a fallback', () => {
    expect(unwrapOr(ok(1), 0)).toBe(1);
    expect(unwrapOr(fail('boom'), 0)).toBe(0);
  });
});
