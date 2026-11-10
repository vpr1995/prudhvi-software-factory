import { Awards } from '../components/awards';
import { Certifications } from '../components/certifications';
import { Contact } from '../components/contact';
import { Experience } from '../components/experience';
import { Hero } from '../components/hero';
import { OpenSource } from '../components/open-source';
import { Skills } from '../components/skills';
import { Writing } from '../components/writing';

/**
 * The home page. A Server Component. The sections appear in the order of decision D-6.
 *
 * @returns The page, inside the `main` landmark of the layout.
 */
export default function HomePage(): React.JSX.Element {
  return (
    <>
      <Hero />
      <Experience />
      <Skills />
      <Awards />
      <Certifications />
      <OpenSource />
      <Writing />
      <Contact />
    </>
  );
}
