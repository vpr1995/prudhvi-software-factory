import type { Content } from '../../src/contracts/content.ts';
import { content as siteContent } from '../lib/content';
import { externalLinkProps } from '../lib/links';

import styles from './awards.module.css';

/** The props of the awards section. The default is the owner's awards from the content. */
type AwardsProps = {
  readonly awards?: Content['awards'];
};

/**
 * The awards section. Each award has its title, year, issuer and a link to its source. The link
 * text names the award for a screen reader.
 *
 * @param props - The awards to show. Defaults to the content.
 * @returns The section.
 */
export function Awards(props: AwardsProps): React.JSX.Element {
  const awards = props.awards ?? siteContent.awards;
  return (
    <section id="awards" aria-labelledby="awards-heading" className={styles['section']}>
      <h2 id="awards-heading">Awards</h2>
      <ul className={styles['list']}>
        {awards.map((award) => (
          <li key={`${award.title}-${award.year}`} className={styles['item']}>
            <h3 className={styles['title']}>{award.title}</h3>
            <p className={styles['meta']}>
              <time className={styles['label']} dateTime={award.year}>
                {award.year}
              </time>
              {award.issuer === undefined ? null : (
                <span className={styles['label']}>{award.issuer}</span>
              )}
            </p>
            <a
              className={styles['source']}
              href={award.source}
              aria-label={`View source for ${award.title}`}
              {...externalLinkProps(award.source)}
            >
              View source
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
