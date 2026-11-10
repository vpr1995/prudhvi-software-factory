'use client';

import { useState, useSyncExternalStore } from 'react';

import { THEME_CHOICES, applyThemeChoice, readStoredChoice, writeStoredChoice } from '../lib/theme';
import type { ThemeChoice } from '../lib/theme';

import styles from './theme-toggle.module.css';

const LABELS: Readonly<Record<ThemeChoice, string>> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

/** Nothing to subscribe to: the page does not change after it loads. */
const subscribeToNothing = (): (() => void) => () => {
  // Nothing to undo: the page does not change after it loads.
};

/**
 * The theme control: three buttons in a labelled group. The control shows only in the browser,
 * after the page loads, so it is absent without JavaScript (R-6). The pre-paint script already
 * applies the stored choice: this control reads the same choice to show it.
 *
 * @returns The control, or nothing on the server and during hydration.
 */
export function ThemeToggle(): React.JSX.Element | null {
  const isMounted = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
  const [choice, setChoice] = useState<ThemeChoice>(() => readStoredChoice());

  if (!isMounted) {
    return null;
  }

  /**
   * Applies and keeps the picked choice.
   *
   * @param next - The picked choice.
   */
  function pickChoice(next: ThemeChoice): void {
    applyThemeChoice(next);
    writeStoredChoice(next);
    setChoice(next);
  }

  return (
    <div role="group" aria-label="Theme" className={styles['group']}>
      {THEME_CHOICES.map((option) => (
        <button
          key={option}
          type="button"
          className={styles['button']}
          aria-pressed={choice === option}
          onClick={() => {
            pickChoice(option);
          }}
        >
          {LABELS[option]}
        </button>
      ))}
    </div>
  );
}
