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
  return (
    <div className={styles['hero']}>
      <h1>{profile.name}</h1>
      <p className={styles['headline']}>{profile.headline}</p>
      <p className={styles['summary']}>{profile.summary}</p>
      <p className={styles['location']}>{formatLocationLine(profile.location)}</p>
      <ul className={styles['actions']}>
        {profileLinks(contact).map((link) => (
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
