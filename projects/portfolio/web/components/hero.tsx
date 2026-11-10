import { content } from '../lib/content';
import { formatLocationLine } from '../lib/format';
import { externalLinkProps, profileLinks } from '../lib/links';

import styles from './hero.module.css';

/**
 * The first section: the name, the role claim, the summary, the location line and the primary
 * links. It reads the content and renders text only.
 *
 * @returns The hero.
 */
export function Hero(): React.JSX.Element {
  const { profile, contact } = content;
  const [primaryLink, ...otherLinks] = profileLinks(contact);
  return (
    <div className={styles['hero']}>
      <p className={styles['status']}>{formatLocationLine(profile.location)}</p>
      <h1 id="hero-heading">{profile.name}</h1>
      <p className={styles['headline']}>{profile.headline}</p>
      <p className={styles['summary']}>{profile.summary}</p>
      <ul className={styles['actions']}>
        {primaryLink === undefined ? null : (
          <li>
            <a
              className={`${styles['action']} ${styles['primary']}`}
              href={primaryLink.href}
              {...externalLinkProps(primaryLink.href)}
            >
              {primaryLink.label}
            </a>
          </li>
        )}
        {otherLinks.map((link) => (
          <li key={link.label}>
            <a className={styles['action']} href={link.href} {...externalLinkProps(link.href)}>
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
