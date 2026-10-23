import Link from 'next/link';

import styles from './site-header.module.css';

/** Props of `SiteHeader`. */
export type SiteHeaderProps = {
  /** True on the home page, where the title is the main heading. */
  readonly isHome?: boolean;
  /** Extra content on the right, for example the progress summary. */
  readonly children?: React.ReactNode;
};

/**
 * The header of every page.
 *
 * @param props - Whether this is the home page, and extra content.
 * @returns The header.
 */
export function SiteHeader(props: SiteHeaderProps): React.JSX.Element {
  const { isHome = false, children } = props;
  const title = (
    <>
      <svg className={styles['logo']} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
        <path d="M2 28 L12 12 L17 19 L22 10 L30 28 Z" />
        <circle cx="24" cy="6" r="3" />
      </svg>
      National Parks Tracker
    </>
  );
  return (
    <header className={styles['header']}>
      <div className={styles['inner']}>
        {isHome ? (
          <h1 className={styles['title']}>{title}</h1>
        ) : (
          <p className={styles['title']}>
            <Link href="/" className={styles['home']}>
              {title}
            </Link>
          </p>
        )}
        {children}
      </div>
    </header>
  );
}
