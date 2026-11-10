import { Awards } from '../components/awards';
import { Contact } from '../components/contact';
import { Experience } from '../components/experience';
import { Hero } from '../components/hero';

/**
 * The home page. A Server Component. The sections appear in the order of decision D-6. Ticket #88
 * adds the open source and writing sections between awards and contact. Add each one here, in its
 * place.
 *
 * @returns The page, inside the `main` landmark of the layout.
 */
export default function HomePage(): React.JSX.Element {
  return (
    <>
      <Hero />
      <Experience />
      <Awards />
      <Contact />
    </>
  );
}
