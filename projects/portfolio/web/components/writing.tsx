import type { Feeds } from '../../src/contracts/feeds.ts';
import { content } from '../lib/content';
import { feeds as siteFeeds } from '../lib/feeds';
import { formatPublishedMonth } from '../lib/format';
import { MEDIUM_ORIGIN, externalLinkProps, isOnOrigin } from '../lib/links';

import styles from './writing.module.css';

/** The props of the writing section. The defaults are the feed snapshot and the content. */
type WritingProps = {
  readonly items?: Feeds['medium']['items'];
  readonly max?: number;
  readonly profileUrl?: string;
};

/**
 * The writing section: the Medium articles, newest first, with the month and the year. An item
 * whose link is not on the Medium origin is not rendered (R-8). Feed text is rendered as text by
 * React, never as HTML (R-11). With no items, the section shows one line with a link to the profile.
 *
 * @param props - The items, the number to show and the profile link. Defaults to the snapshot.
 * @returns The section.
 */
export function Writing(props: WritingProps): React.JSX.Element {
  const profileUrl = props.profileUrl ?? content.contact.medium;
  const max = props.max ?? content.medium.max;
  const shown = (props.items ?? siteFeeds.medium.items)
    .filter((item) => isOnOrigin(item.url, MEDIUM_ORIGIN))
    .sort((first, second) => Date.parse(second.publishedAt) - Date.parse(first.publishedAt))
    .slice(0, max);

  return (
    <section id="writing" aria-labelledby="writing-heading" className="section">
      <h2 id="writing-heading">Writing</h2>
      {shown.length === 0 ? (
        <p className={styles['fallback']}>
          <a href={profileUrl} {...externalLinkProps(profileUrl)}>
            Read my articles on Medium
          </a>
        </p>
      ) : (
        <ul className={styles['list']}>
          {shown.map((item) => (
            <li key={item.url} className={styles['item']}>
              <h3 className={styles['title']}>
                <a href={item.url} {...externalLinkProps(item.url)} className={styles['link']}>
                  {item.title}
                </a>
              </h3>
              <time className={styles['date']} dateTime={item.publishedAt}>
                {formatPublishedMonth(item.publishedAt)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
