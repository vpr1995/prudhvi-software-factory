import { content } from '../lib/content';
import { formatLocationLine } from '../lib/format';
import { externalLinkProps, profileLinks } from '../lib/links';

import styles from './hero.module.css';

/** The inline icon of each contact link. Drawn with the text colour, hidden from screen readers. */
const ICONS: Readonly<Record<string, React.JSX.Element>> = {
  Email: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </>
  ),
  LinkedIn: (
    <>
      <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
      <rect x="2" y="9" width="4" height="12" />
      <circle cx="4" cy="4" r="2" />
    </>
  ),
  GitHub: (
    <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
  ),
  Medium: <path d="M3 7v10M3 7l4.5 8L12 7v10M16 7.5v9M20.5 9v6" />,
};

/**
 * The first section: the name, the role claim, the summary, the relocation line and the contact
 * links. A card lists the places. It reads the content and renders text only.
 *
 * @returns The hero.
 */
export function Hero(): React.JSX.Element {
  const { profile, contact } = content;
  const places = [profile.location.primary, ...profile.location.also];
  const [emailLink] = profileLinks(contact);
  return (
    <div className={styles['hero']}>
      <div className={styles['text']}>
        <p className={styles['eyebrow']}>{formatLocationLine(profile.location)}</p>
        <h1 id="hero-heading">{profile.name}</h1>
        <p className={styles['headline']}>{profile.headline}</p>
        <p className={styles['summary']}>{profile.summary}</p>
        <div className={styles['ctas']}>
          {emailLink === undefined ? null : (
            <a
              className={styles['primary']}
              href={emailLink.href}
              {...externalLinkProps(emailLink.href)}
            >
              Email
            </a>
          )}
          <a className={styles['secondary']} href="#writing">
            View writing
          </a>
        </div>
      </div>
      <div className={styles['aside']}>
        <div className={styles['card']}>
          <p className={styles['cardEyebrow']}>Open to relocation</p>
          <ul className={styles['places']}>
            {places.map((place, index) => (
              <li key={place} className={styles['place']}>
                <span>{place}</span>
                {index === 0 ? <span className={styles['badge']}>Primary</span> : null}
              </li>
            ))}
          </ul>
        </div>
        <ul className={styles['links']}>
          {profileLinks(contact).map((link) => (
            <li key={link.label}>
              <a
                className={styles['icon']}
                href={link.href}
                aria-label={link.label}
                {...externalLinkProps(link.href)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  {ICONS[link.label]}
                </svg>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
