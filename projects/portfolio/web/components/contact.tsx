import { content } from '../lib/content';
import { externalLinkProps, profileLinks } from '../lib/links';
import { encodePhone } from '../lib/phone-token';

import styles from './contact.module.css';
import { PhoneReveal } from './phone-reveal';

/**
 * The contact section: the email address, LinkedIn, GitHub, Medium and, when the content has one,
 * the phone number behind a click (R-5). The phone is passed as a token, not as plain text.
 *
 * @returns The section.
 */
export function Contact(): React.JSX.Element {
  return (
    <section id="contact" aria-labelledby="contact-heading" className="section">
      <div className="section-header">
        <p className="section-eyebrow">Get in touch</p>
        <h2 id="contact-heading">Contact</h2>
      </div>
      <ul className={styles['list']}>
        {profileLinks(content.contact).map((link) => (
          <li key={link.label} className={styles['row']}>
            <span className={styles['label']}>{link.label}</span>
            <a className={styles['value']} href={link.href} {...externalLinkProps(link.href)}>
              {link.text}
            </a>
          </li>
        ))}
        {content.contact.phone === undefined ? null : (
          <PhoneReveal token={encodePhone(content.contact.phone)} />
        )}
      </ul>
    </section>
  );
}
