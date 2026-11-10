// Link helpers for the sections. A link that leaves the page gets `rel="noopener noreferrer"`. Only
// an https link opens in a new tab (R-11, and the security rule of REVIEW.md).
import type { Content } from '../../src/contracts/content.ts';

/** A contact link: the label, the href, and the text the link shows. */
export type ProfileLink = {
  readonly label: string;
  readonly href: string;
  readonly text: string;
};

/**
 * Lists the contact links in the order the page shows them: email, LinkedIn, GitHub, Medium.
 *
 * @param contact - The contact block of the content.
 * @returns The links.
 */
export function profileLinks(contact: Content['contact']): readonly ProfileLink[] {
  return [
    { label: 'Email', href: `mailto:${contact.email}`, text: contact.email },
    { label: 'LinkedIn', href: contact.linkedin, text: contact.linkedin },
    { label: 'GitHub', href: contact.github, text: contact.github },
    { label: 'Medium', href: contact.medium, text: contact.medium },
  ];
}

/**
 * The attributes of an outgoing link. Every link gets `rel="noopener noreferrer"`. An https link
 * also opens in a new tab.
 *
 * @param href - The href of the link.
 * @returns The `target` and `rel` attributes.
 */
export function externalLinkProps(href: string): {
  readonly target?: '_blank';
  readonly rel: 'noopener noreferrer';
} {
  const isHttps = isHttpsUrl(href);
  return isHttps
    ? { target: '_blank', rel: 'noopener noreferrer' }
    : { rel: 'noopener noreferrer' };
}

/**
 * Tells whether a text is an absolute https URL.
 *
 * @param href - The text.
 * @returns True for `https://` URLs.
 */
function isHttpsUrl(href: string): boolean {
  try {
    return new URL(href).protocol === 'https:';
  } catch {
    return false;
  }
}
