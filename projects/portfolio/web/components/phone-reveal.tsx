'use client';

import { useId, useState, useSyncExternalStore } from 'react';

import { decodePhone } from '../lib/phone-token';
import type { PhoneLink } from '../lib/phone-token';

import styles from './phone-reveal.module.css';

/** The visible text of the control. Its accessible name is the same text. */
const BUTTON_TEXT = 'Show phone number';

/** Nothing to subscribe to: the page does not change after it loads. */
const subscribeToNothing = (): (() => void) => () => {
  // Nothing to undo: the page does not change after it loads.
};

/** Props of the reveal control. */
type PhoneRevealProps = {
  /** The phone token from `encodePhone`, written by the Server Component. */
  readonly token: string;
};

/**
 * The phone row of the contact section. Before the click it shows a button. The click shows the
 * number as a tel: link inside a polite live region, so a screen reader announces it. The row
 * renders only in the browser, after the page loads, so with JavaScript off nothing about the
 * phone shows (R-5, R-6).
 *
 * @param props - The token of the phone.
 * @returns The list row, or nothing on the server and during hydration.
 */
export function PhoneReveal(props: PhoneRevealProps): React.JSX.Element | null {
  const isMounted = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
  const regionId = useId();
  const [phone, setPhone] = useState<PhoneLink | undefined>(undefined);

  if (!isMounted) {
    return null;
  }

  /** Decodes the number and shows it. A token that does not decode shows nothing. */
  function reveal(): void {
    const decoded = decodePhone(props.token);
    if (decoded !== undefined) {
      setPhone(decoded);
    }
  }

  return (
    <li className={styles['row']}>
      <span className={styles['label']}>Phone</span>
      <div className={styles['value']}>
        <button
          type="button"
          className={styles['button']}
          aria-expanded={phone !== undefined}
          aria-controls={regionId}
          onClick={reveal}
        >
          {BUTTON_TEXT}
        </button>
        <span id={regionId} className={styles['region']} aria-live="polite">
          {phone === undefined ? null : (
            <a className={styles['link']} href={phone.href}>
              {phone.display}
            </a>
          )}
        </span>
      </div>
    </li>
  );
}
