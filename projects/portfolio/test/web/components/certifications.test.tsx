import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { Content } from '../../../src/contracts/content';
import { Certifications } from '../../../web/components/certifications';
import { content } from '../../../web/lib/content';

const certifications: Content['certifications'] = [
  {
    name: 'Cloud Architect',
    issuer: 'Acme Cloud',
    level: 'Associate',
    issued: '2024-09',
    expires: '2027-09',
    credentialUrl: 'https://example.com/credential/1',
  },
  { name: 'Plain Cert', issuer: 'Beta Org', issued: '2022-03' },
];

describe('Certifications', () => {
  it('has a section labelled by its level 2 heading', () => {
    render(<Certifications certifications={certifications} />);
    const heading = screen.getByRole('heading', { level: 2, name: 'Certifications' });
    const section = heading.closest('section');
    expect(section).toHaveAttribute('id', 'certifications');
    expect(section).toHaveAttribute('aria-labelledby', heading.id);
  });

  it('shows the name, the issuer, the level and the dates of a full entry', () => {
    render(<Certifications certifications={certifications} />);
    expect(screen.getByRole('heading', { level: 3, name: 'Cloud Architect' })).toBeInTheDocument();
    expect(screen.getByText('Acme Cloud')).toBeInTheDocument();
    expect(screen.getByText('Associate')).toBeInTheDocument();
    expect(screen.getByText('Issued Sep 2024 · Expires Sep 2027')).toBeInTheDocument();
  });

  it('links the credential with rel noopener noreferrer', () => {
    render(<Certifications certifications={certifications} />);
    const link = screen.getByRole('link', { name: 'View credential for Cloud Architect' });
    expect(link).toHaveAttribute('href', 'https://example.com/credential/1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('leaves out the level, the expiry and the link when the entry has none', () => {
    render(<Certifications certifications={certifications} />);
    expect(screen.getByText('Issued Mar 2022')).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('shows the certifications of the content by default', () => {
    render(<Certifications />);
    for (const certification of content.certifications) {
      expect(
        screen.getByRole('heading', { level: 3, name: certification.name }),
      ).toBeInTheDocument();
    }
  });
});
