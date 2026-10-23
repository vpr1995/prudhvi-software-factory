import type { Metadata, Viewport } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'National Parks Tracker',
  description:
    'A map of the 64 US national parks, with the parks we have visited, our trips, notes and photos.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f3ec' },
    { media: '(prefers-color-scheme: dark)', color: '#101612' },
  ],
};

/** Props of the root layout. */
type RootLayoutProps = {
  readonly children: React.ReactNode;
};

/**
 * The root layout of every page.
 *
 * @param props - The page to show.
 * @returns The HTML shell with a skip link.
 */
export default function RootLayout(props: RootLayoutProps): React.JSX.Element {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to main content
        </a>
        {props.children}
      </body>
    </html>
  );
}
