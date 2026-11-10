import { describe, expect, it } from 'vitest';

import { externalLinkProps, profileLinks } from '../../../web/lib/links';

describe('externalLinkProps', () => {
  it('opens an https link in a new tab without a referrer or an opener', () => {
    expect(externalLinkProps('https://github.com/vpr1995')).toEqual({
      target: '_blank',
      rel: 'noopener noreferrer',
    });
  });

  it('gives a mailto link the rel but no new tab', () => {
    const props = externalLinkProps('mailto:someone@example.com');
    expect(props.rel).toBe('noopener noreferrer');
    expect(props.target).toBeUndefined();
  });
});

describe('profileLinks', () => {
  it('lists email, LinkedIn, GitHub and Medium in that order', () => {
    const links = profileLinks({
      email: 'someone@example.com',
      linkedin: 'https://www.linkedin.com/in/someone',
      github: 'https://github.com/someone',
      medium: 'https://medium.com/@someone',
    });
    expect(links.map((link) => link.label)).toEqual(['Email', 'LinkedIn', 'GitHub', 'Medium']);
    expect(links[0]?.href).toBe('mailto:someone@example.com');
    expect(links[0]?.text).toBe('someone@example.com');
    expect(links[2]?.href).toBe('https://github.com/someone');
  });
});
