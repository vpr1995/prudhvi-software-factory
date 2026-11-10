import { content } from '../lib/content';

/**
 * The home page. A Server Component. The sections come in later tasks.
 *
 * @returns The page.
 */
export default function HomePage(): React.JSX.Element {
  return (
    <section>
      <h1>{content.profile.name}</h1>
    </section>
  );
}
