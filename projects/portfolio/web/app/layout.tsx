import { GeistMono } from 'geist/font/mono';
import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans, Space_Grotesk } from 'next/font/google';

import './globals.css';

import { ThemeToggle } from '../components/theme-toggle';
import { content } from '../lib/content';
import { externalLinkProps } from '../lib/links';
import { THEME_COLORS, THEME_SCRIPT } from '../lib/theme';

import styles from './layout.module.css';

/**
 * The in-page links of the top bar. Each target is a section of the home page.
 */
const SECTION_LINKS: readonly { readonly href: string; readonly label: string }[] = [
  { href: '#experience', label: 'Experience' },
  { href: '#skills', label: 'Skills' },
  { href: '#awards', label: 'Awards' },
  { href: '#certifications', label: 'Certifications' },
  { href: '#open-source', label: 'Open source' },
  { href: '#writing', label: 'Writing' },
  { href: '#contact', label: 'Contact' },
];

/** The display font. next/font downloads it at build time and serves it from this site. */
const displayFont = Space_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-display',
});

/** The body font, served the same way. */
const bodyFont = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-body',
});

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
    <html
      lang="en"
      className={`${displayFont.variable} ${bodyFont.variable} ${GeistMono.variable}`}
    >
      <head>
        <script>{THEME_SCRIPT}</script>
      </head>
      <body id="top">
        <a className="skip-link" href="#main">
          Skip to main content
        </a>
        <header className={styles['topBar']}>
          <div className={styles['pill']}>
            <a className={styles['siteName']} href="#top">
              {content.profile.name}
            </a>
            <nav aria-label="Sections" className={styles['nav']}>
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
            <div className={styles['actions']}>
              <a
                className={styles['email']}
                href={`mailto:${content.contact.email}`}
                {...externalLinkProps(`mailto:${content.contact.email}`)}
              >
                Email
              </a>
              <ThemeToggle />
            </div>
          </div>
        </header>
        <main id="main" className={styles['main']}>
          {props.children}
        </main>
      </body>
    </html>
  );
}
