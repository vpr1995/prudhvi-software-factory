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

/** The icon of each choice. Inline SVG, drawn with the text colour, hidden from screen readers. */
const ICONS: Readonly<Record<ThemeChoice, React.JSX.Element>> = {
  system: (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={styles['icon']}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  ),
  light: (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={styles['icon']}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  ),
  dark: (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={styles['icon']}>
      <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" />
    </svg>
  ),
};

/** Nothing to subscribe to: the page does not change after it loads. */
const subscribeToNothing = (): (() => void) => () => {
  // Nothing to undo: the page does not change after it loads.
};

/**
 * The theme control: three icon buttons (system, sun, moon) in a labelled group. The control shows only in the browser,
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
          title={LABELS[option]}
          aria-pressed={choice === option}
          onClick={() => {
            pickChoice(option);
          }}
        >
          {ICONS[option]}
          <span className="visually-hidden">{LABELS[option]}</span>
        </button>
      ))}
    </div>
  );
}
