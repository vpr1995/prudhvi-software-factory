import type { Content } from '../../src/contracts/content.ts';
import { content } from '../lib/content';

import styles from './skills.module.css';

/** The props of the skills section. The default is the owner's skill groups from the content. */
type SkillsProps = {
  readonly groups?: Content['skills'];
};

/**
 * The skills section: one card for each group, with its skills as chips. It renders text only.
 *
 * @param props - The groups to show. Defaults to the content.
 * @returns The section.
 */
export function Skills(props: SkillsProps): React.JSX.Element {
  const groups = props.groups ?? content.skills;
  return (
    <section id="skills" aria-labelledby="skills-heading" className="section">
      <div className="section-header">
        <p className="section-eyebrow">Technical stack</p>
        <h2 id="skills-heading">Skills</h2>
      </div>
      <ul className={styles['grid']}>
        {groups.map((group) => (
          <li key={group.category} className={styles['card']}>
            <h3 className={styles['title']}>{group.category}</h3>
            <ul className={styles['chips']}>
              {group.items.map((item) => (
                <li key={item} className={styles['chip']}>
                  {item}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
