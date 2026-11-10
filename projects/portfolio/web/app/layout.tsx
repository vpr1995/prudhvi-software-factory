import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import type { Metadata, Viewport } from 'next';

import './globals.css';

import { ThemeToggle } from '../components/theme-toggle';
import { content } from '../lib/content';
import { THEME_COLORS, THEME_SCRIPT } from '../lib/theme';

import styles from './layout.module.css';

/**
 * The in-page links of the top bar. Each target is a section of the home page.
 */
const SECTION_LINKS: readonly { readonly href: string; readonly label: string }[] = [
  { href: '#experience', label: 'Experience' },
  { href: '#awards', label: 'Awards' },
  { href: '#open-source', label: 'Open source' },
  { href: '#writing', label: 'Writing' },
  { href: '#contact', label: 'Contact' },
];

const OG_IMAGES = content.site.ogImage === undefined ? undefined : [content.site.ogImage];

export const metadata: Metadata = {
  metadataBase: new URL(content.site.url),
  title: content.site.title,
  description: content.site.description,
  openGraph: {
    title: content.site.title,
    description: content.site.description,
    url: content.site.url,
    siteName: content.profile.name,
    type: 'website',
    images: OG_IMAGES,
  },
  twitter: {
    card: 'summary',
    title: content.site.title,
    description: content.site.description,
    images: OG_IMAGES,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: THEME_COLORS.light },
    { media: '(prefers-color-scheme: dark)', color: THEME_COLORS.dark },
  ],
};

/** Props of the root layout. */
type RootLayoutProps = {
  readonly children: React.ReactNode;
};

/**
 * The root layout of every page: the fonts, the pre-paint theme script, a skip link, the top bar
 * with the theme toggle, and the main landmark that holds each page.
 *
 * @param props - The page to show.
 * @returns The HTML shell.
 */
export default function RootLayout(props: RootLayoutProps): React.JSX.Element {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <head>
        <script>{THEME_SCRIPT}</script>
      </head>
      <body>
        <a className="skip-link" href="#main">
          Skip to main content
        </a>
        <header className={styles['topBar']}>
          <p className={styles['siteName']}>{content.profile.name}</p>
          <nav aria-label="Sections">
            <ul className={styles['sectionList']}>
              {SECTION_LINKS.map((link) => (
                <li key={link.href}>
                  <a className={styles['sectionLink']} href={link.href}>
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <ThemeToggle />
        </header>
        <main id="main" className={styles['main']}>
          {props.children}
        </main>
      </body>
    </html>
  );
}
