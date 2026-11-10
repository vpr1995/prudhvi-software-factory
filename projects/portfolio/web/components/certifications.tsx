import type { Content } from '../../src/contracts/content.ts';
import { content } from '../lib/content';
import { formatMonth } from '../lib/format';
import { externalLinkProps } from '../lib/links';

import styles from './certifications.module.css';

/** The props of the certifications section. The default is the owner's entries from the content. */
type CertificationsProps = {
  readonly certifications?: Content['certifications'];
};

/**
 * Writes the dates line of a certification, for example `Issued Sep 2024 · Expires Sep 2027`.
 *
 * @param certification - The certification.
 * @returns The line.
 */
function datesOf(certification: Content['certifications'][number]): string {
  const issued = `Issued ${formatMonth(certification.issued)}`;
  return certification.expires === undefined
    ? issued
    : `${issued} · Expires ${formatMonth(certification.expires)}`;
}

/**
 * The certifications section: one card for each credential, with its level, issuer, dates and, when
 * the content has one, a link to the credential. It renders text only.
 *
 * @param props - The certifications to show. Defaults to the content.
 * @returns The section.
 */
export function Certifications(props: CertificationsProps): React.JSX.Element {
  const certifications = props.certifications ?? content.certifications;
  return (
    <section id="certifications" aria-labelledby="certifications-heading" className="section">
      <div className="section-header">
        <p className="section-eyebrow">Verified credentials</p>
        <h2 id="certifications-heading">Certifications</h2>
      </div>
      <ul className={styles['grid']}>
        {certifications.map((certification) => (
          <li key={`${certification.name}-${certification.issued}`} className={styles['card']}>
            {certification.level === undefined ? null : (
              <span className={styles['level']}>{certification.level}</span>
            )}
            <h3 className={styles['title']}>{certification.name}</h3>
            <p className={styles['issuer']}>{certification.issuer}</p>
            <p className={styles['dates']}>{datesOf(certification)}</p>
            {certification.credentialUrl === undefined ? null : (
              <a
                className={styles['credential']}
                href={certification.credentialUrl}
                aria-label={`View credential for ${certification.name}`}
                {...externalLinkProps(certification.credentialUrl)}
              >
                View credential
                <span aria-hidden="true"> ↗</span>
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
