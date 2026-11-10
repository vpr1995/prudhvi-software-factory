import { describe, expect, it } from 'vitest';

import {
  GITHUB_ORIGIN,
  MEDIUM_ORIGIN,
  externalLinkProps,
  isOnOrigin,
  profileLinks,
} from '../../../web/lib/links';

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

describe('isOnOrigin', () => {
  it('accepts a link on the Medium origin and on the GitHub origin', () => {
    expect(isOnOrigin('https://medium.com/@vprprudhvi/post-abc', MEDIUM_ORIGIN)).toBe(true);
    expect(isOnOrigin('https://github.com/vpr1995/repo', GITHUB_ORIGIN)).toBe(true);
  });

  it('rejects another origin, a look-alike host and a link that is not https', () => {
    expect(isOnOrigin('https://evil.example.com/post', MEDIUM_ORIGIN)).toBe(false);
    expect(isOnOrigin('https://medium.com.evil.example.com/post', MEDIUM_ORIGIN)).toBe(false);
    expect(isOnOrigin('https://github.com.evil.example.com/x', GITHUB_ORIGIN)).toBe(false);
    expect(isOnOrigin('http://medium.com/@vprprudhvi/post', MEDIUM_ORIGIN)).toBe(false);
    expect(isOnOrigin('javascript:alert(1)', GITHUB_ORIGIN)).toBe(false);
  });

  it('rejects the bare origin with no path', () => {
    expect(isOnOrigin('https://medium.com/', MEDIUM_ORIGIN)).toBe(false);
  });
});
