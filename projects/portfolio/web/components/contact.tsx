import { content } from '../lib/content';
import { externalLinkProps, profileLinks } from '../lib/links';

import styles from './contact.module.css';

/**
 * The contact section: the email address, LinkedIn, GitHub and Medium. The phone number is not
 * here yet. The phone reveal comes in a later ticket, at the marked place below.
 *
 * @returns The section.
 */
export function Contact(): React.JSX.Element {
  return (
    <section id="contact" aria-labelledby="contact-heading" className={styles['section']}>
      <h2 id="contact-heading">Contact</h2>
      <ul className={styles['list']}>
        {profileLinks(content.contact).map((link) => (
          <li key={link.label} className={styles['row']}>
            <span className={styles['label']}>{link.label}</span>
            <a className={styles['value']} href={link.href} {...externalLinkProps(link.href)}>
              {link.text}
            </a>
          </li>
        ))}
      </ul>
      {/* PHONE REVEAL: ticket #89 adds the click-to-reveal phone number here. Render nothing for
          phone until then (R-5, R-6). */}
    </section>
  );
}
