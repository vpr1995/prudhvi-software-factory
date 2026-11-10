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
    <section id="awards" aria-labelledby="awards-heading" className="section">
      <div className="section-header">
        <p className="section-eyebrow">Recognition</p>
        <h2 id="awards-heading">Awards</h2>
      </div>
      <ul className={styles['list']}>
        {awards.map((award) => (
          <li key={`${award.title}-${award.year}`} className={styles['card']}>
            <time className={styles['year']} dateTime={award.year}>
              {award.year}
            </time>
            <h3 className={styles['title']}>{award.title}</h3>
            {award.issuer === undefined ? null : <p className={styles['issuer']}>{award.issuer}</p>}
            <a
              className={styles['source']}
              href={award.source}
              aria-label={`View source for ${award.title}`}
              {...externalLinkProps(award.source)}
            >
              View source
              <span aria-hidden="true"> ↗</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
