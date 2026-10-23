'use client';

import { useId } from 'react';

import { joinClassNames } from '../lib/class-names';
import { isSort, SORTS, STATUSES } from '../lib/search';
import type { ListState, Sort, Status, StatusCounts } from '../lib/search';

import styles from './list-controls.module.css';

const STATUS_LABELS: Readonly<Record<Status, string>> = {
  all: 'All',
  visited: 'Visited',
  'not-visited': 'Not yet',
};

const SORT_LABELS: Readonly<Record<Sort, string>> = {
  name: 'Name',
  state: 'State',
  established: 'Established (newest)',
  'last-visited': 'Last visited',
  rating: 'Rating',
};

/** Props of `ListControls`. */
export type ListControlsProps = {
  readonly state: ListState;
  readonly counts: StatusCounts;
  readonly onChange: (next: ListState) => void;
};

/**
 * The search box, the status filter and the sort order of the park list.
 *
 * @param props - The state, the counts and the change callback.
 * @returns The controls.
 */
export function ListControls(props: ListControlsProps): React.JSX.Element {
  const { state, counts, onChange } = props;
  const id = useId();
  return (
    <div className={styles['controls']}>
      <div className={styles['field']}>
        <label htmlFor={`${id}-search`}>Search parks</label>
        <input
          id={`${id}-search`}
          className={styles['search']}
          type="search"
          value={state.query}
          placeholder="Name or state"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            onChange({ ...state, query: event.target.value });
          }}
        />
      </div>
      <fieldset className={styles['status']}>
        <legend className="visually-hidden">Show parks</legend>
        {STATUSES.map((status) => (
          <label key={status} className={styles['segment']}>
            <input
              type="radio"
              name={`${id}-status`}
              value={status}
              checked={state.status === status}
              onChange={() => {
                onChange({ ...state, status });
              }}
            />
            <span>
              {STATUS_LABELS[status]} <span className={styles['count']}>({counts[status]})</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className={joinClassNames(styles['field'], styles['sortField'])}>
        <label htmlFor={`${id}-sort`}>Sort by</label>
        <select
          id={`${id}-sort`}
          className={styles['sort']}
          value={state.sort}
          onChange={(event) => {
            const { value } = event.target;
            if (isSort(value)) {
              onChange({ ...state, sort: value });
            }
          }}
        >
          {SORTS.map((sort) => (
            <option key={sort} value={sort}>
              {SORT_LABELS[sort]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
