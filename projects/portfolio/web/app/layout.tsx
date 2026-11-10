import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import type { Metadata, Viewport } from 'next';

import './globals.css';

import { ThemeToggle } from '../components/theme-toggle';
import { content } from '../lib/content';
import { THEME_COLORS, THEME_SCRIPT } from '../lib/theme';

import styles from './layout.module.css';

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
          <ThemeToggle />
        </header>
        <main id="main" className={styles['main']}>
          {props.children}
        </main>
      </body>
    </html>
  );
}
