import { describe, expect, it } from 'vitest';

import { decodePhone, encodePhone } from '../../../web/lib/phone-token';

const PHONE = { display: '+1 (555) 010-0100', href: 'tel:+15550100100' };

describe('phone token', () => {
  it('decodes what it encodes', () => {
    expect(decodePhone(encodePhone(PHONE))).toEqual(PHONE);
  });

  it('keeps text outside ASCII intact', () => {
    const phone = { display: 'Tél. +33 1 23 45 67 89', href: 'tel:+33123456789' };
    expect(decodePhone(encodePhone(phone))).toEqual(phone);
  });

  it('does not show the number as plain text in the token', () => {
    const token = encodePhone(PHONE);
    expect(token).not.toContain('010-0100');
    expect(token).not.toContain('tel:');
  });

  it('returns undefined for a token that is not base64', () => {
    expect(decodePhone('not base64 !!')).toBeUndefined();
  });

  it('returns undefined for a value that is not a phone link', () => {
    const missingHref = btoa(JSON.stringify({ display: '+1 (555) 010-0100' }));
    expect(decodePhone(missingHref)).toBeUndefined();
  });
});
