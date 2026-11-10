import type { Content } from '../../src/contracts/content.ts';
import type { GithubRepository } from '../../src/contracts/feeds.ts';
import { content } from '../lib/content';
import { feeds as siteFeeds } from '../lib/feeds';
import { GITHUB_ORIGIN, externalLinkProps, isOnOrigin } from '../lib/links';

import styles from './open-source.module.css';

/** The props of the open source section. The defaults are the owner's pins and the snapshot. */
type OpenSourceProps = {
  readonly pinnedRepos?: Content['pinnedRepos'];
  readonly repos?: readonly GithubRepository[];
  readonly profileUrl?: string;
};

/**
 * The open source section: the pinned repos. Each repo shows its name, the owner's blurb first and
 * then the fetched description. The link is built from the name, so a pinned repo that is not in the
 * snapshot still has a link. A feed repo whose URL is not on GitHub gives no description (R-8).
 * Feed text is rendered as text by React, never as HTML (R-11).
 *
 * @param props - The pins, the feed repos and the profile link. Defaults to the content and snapshot.
 * @returns The section.
 */
export function OpenSource(props: OpenSourceProps): React.JSX.Element {
  const pinnedRepos = props.pinnedRepos ?? content.pinnedRepos;
  const repos = props.repos ?? siteFeeds.github.repos;
  const profileUrl = props.profileUrl ?? content.contact.github;

  return (
    <section id="open-source" aria-labelledby="open-source-heading" className="section">
      <h2 id="open-source-heading">Open source</h2>
      {pinnedRepos.length === 0 ? (
        <p className={styles['fallback']}>
          <a href={profileUrl} {...externalLinkProps(profileUrl)}>
            See my repos on GitHub
          </a>
        </p>
      ) : (
        <ul className={styles['list']}>
          {pinnedRepos.map((pinned) => {
            const href = `${GITHUB_ORIGIN}${pinned.fullName}`;
            const feed = repos.find(
              (repository) =>
                repository.fullName === pinned.fullName &&
                isOnOrigin(repository.url, GITHUB_ORIGIN),
            );
            const description = feed?.description;
            return (
              <li key={pinned.fullName} className={styles['card']}>
                <h3 className={styles['title']}>
                  <a href={href} {...externalLinkProps(href)} className={styles['link']}>
                    {pinned.fullName}
                  </a>
                </h3>
                {pinned.blurb === undefined ? null : (
                  <p className={styles['blurb']}>{pinned.blurb}</p>
                )}
                {description === undefined || description === null ? null : (
                  <p className={styles['description']}>{description}</p>
                )}
                <span className={styles['affordance']} aria-hidden="true">
                  GitHub ↗
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
