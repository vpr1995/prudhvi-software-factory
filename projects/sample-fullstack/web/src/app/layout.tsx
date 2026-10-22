import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Notes',
  description: 'A small notes app. It shows how the web, the API and tracing fit together.',
};

/** Props of the root layout. */
type RootLayoutProps = {
  readonly children: React.ReactNode;
};

/**
 * The root layout of every page.
 *
 * @param props - The page to show.
 * @returns The HTML shell.
 */
export default function RootLayout(props: RootLayoutProps): React.JSX.Element {
  return (
    <html lang="en">
      <body>{props.children}</body>
    </html>
  );
}
