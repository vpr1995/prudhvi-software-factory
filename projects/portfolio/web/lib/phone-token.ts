// The phone number travels from the Server Component to the reveal control as a token. Props are
// written into the page's data for the client, so a plain number would be readable in the HTML
// before the click. The token is base64 of the JSON of the link. This is obfuscation, not secrecy:
// the design accepts that the number is effectively public (brief row 2).

/** The phone link of the contact block: the text the link shows, and the tel: href. */
export type PhoneLink = {
  readonly display: string;
  readonly href: string;
};

/**
 * Tells whether a value is a phone link: an object with a text `display` and a text `href`.
 *
 * @param value - The value to check.
 * @returns True for a phone link.
 */
function isPhoneLink(value: unknown): value is PhoneLink {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return (
    'display' in value &&
    'href' in value &&
    typeof value.display === 'string' &&
    typeof value.href === 'string'
  );
}

/**
 * Encodes a phone link as a token. The text is UTF-8, so text outside ASCII is safe.
 *
 * @param phone - The phone link.
 * @returns The token, in base64.
 */
export function encodePhone(phone: PhoneLink): string {
  const bytes = new TextEncoder().encode(JSON.stringify(phone));
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/**
 * Decodes a token. A token that does not decode to a phone link gives undefined.
 *
 * @param token - The token from `encodePhone`.
 * @returns The phone link, or undefined.
 */
export function decodePhone(token: string): PhoneLink | undefined {
  try {
    const binary = atob(token);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return isPhoneLink(value) ? value : undefined;
  } catch {
    return undefined;
  }
}
