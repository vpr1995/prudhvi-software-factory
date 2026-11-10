import type { Content } from '../../src/contracts/content.ts';
import { content as siteContent } from '../lib/content';
import { formatPeriod } from '../lib/format';

import styles from './experience.module.css';

/** The props of the experience section. The default is the owner's entries from the content. */
type ExperienceProps = {
  readonly entries?: Content['experience'];
};

/**
 * The experience section. Each entry has its period, role, company, location, bullets and, when
 * the content has them, metrics shown as figures.
 *
 * @param props - The entries to show. Defaults to the content.
 * @returns The section.
 */
export function Experience(props: ExperienceProps): React.JSX.Element {
  const entries = props.entries ?? siteContent.experience;
  return (
    <section id="experience" aria-labelledby="experience-heading" className="section">
      <div className="section-header">
        <p className="section-eyebrow">Career journey</p>
        <h2 id="experience-heading">Experience</h2>
      </div>
      <ol className={styles['list']}>
        {entries.map((entry) => (
          <li key={`${entry.company}-${entry.start}`} className={styles['entry']}>
            <p className={styles['period']}>{formatPeriod(entry.start, entry.end)}</p>
            <div className={styles['rail']} aria-hidden="true" />
            <div className={styles['card']}>
              <h3 className={styles['role']}>{entry.role}</h3>
              <p className={styles['meta']}>
                <span className={styles['company']}>{entry.company}</span>
                <span className={styles['place']}>{entry.location}</span>
              </p>
              <ul className={styles['bullets']}>
                {entry.bullets.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
              {entry.metrics !== undefined && entry.metrics.length > 0 ? (
                <dl className={styles['metrics']}>
                  {entry.metrics.map((metric) => (
                    <div key={metric.label} className={styles['metric']}>
                      <dt className={styles['metricLabel']}>{metric.label}</dt>
                      <dd className={styles['figure']}>{metric.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
