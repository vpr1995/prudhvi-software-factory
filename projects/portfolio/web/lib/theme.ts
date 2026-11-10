// The theme of the page: the visitor picks system, light or dark (R-13). The choice is kept in
// localStorage. The page sets the `data-theme` attribute on <html>: CSS reads it (globals.css).

/** The three states of the theme. `system` follows the operating system. */
export const THEME_CHOICES = ['system', 'light', 'dark'] as const;

/** One state of the theme. */
export type ThemeChoice = (typeof THEME_CHOICES)[number];

/** The localStorage key of the choice. THEME_SCRIPT reads the same key: keep the two in step. */
export const THEME_STORAGE_KEY = 'theme';

/** The browser chrome colours. They match the background tokens in globals.css. */
export const THEME_COLORS = { light: '#fbfbf8', dark: '#0f0f0e' } as const;

/**
 * The script that sets the theme before the first paint. The layout puts it in <head> as a plain
 * inline script: the browser runs it while it reads the page, before the first paint. It is a fixed
 * string, so its CSP hash is the same on every build of the same text, and scripts/headers.ts hashes
 * it. Do not build it from values at run time. The key must match THEME_STORAGE_KEY.
 *
 * It sets `data-theme` only for a stored light or dark choice. Otherwise the CSS follows the system.
 */
export const THEME_SCRIPT = `(function () {
  try {
    var theme = window.localStorage.getItem('theme');
    if (theme === 'light' || theme === 'dark') {
      document.documentElement.dataset.theme = theme;
    }
  } catch (error) {
    // Storage is blocked. The page follows the system theme.
  }
})();`;

/** The choices as a set, for the check of a stored value. */
const CHOICE_VALUES: ReadonlySet<unknown> = new Set<unknown>(THEME_CHOICES);

/** The part of localStorage that the theme uses. */
export type ThemeStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * Tells whether a value is one of the theme choices.
 *
 * @param value - The value to check.
 * @returns True when the value is `system`, `light` or `dark`.
 */
function isThemeChoice(value: unknown): value is ThemeChoice {
  return CHOICE_VALUES.has(value);
}

/**
 * Reads the stored choice. Storage can be blocked or hold a value that is not a choice: then the
 * result is `system`.
 *
 * @param storage - The storage. Defaults to `window.localStorage`.
 * @returns The stored choice, or `system`.
 */
export function readStoredChoice(storage?: ThemeStorage): ThemeChoice {
  try {
    const value = (storage ?? window.localStorage).getItem(THEME_STORAGE_KEY);
    return isThemeChoice(value) ? value : 'system';
  } catch {
    return 'system';
  }
}

/**
 * Keeps the choice. `system` removes the key. A blocked storage keeps nothing: the choice still
 * applies for this page view.
 *
 * @param choice - The choice to keep.
 * @param storage - The storage. Defaults to `window.localStorage`.
 */
export function writeStoredChoice(choice: ThemeChoice, storage?: ThemeStorage): void {
  try {
    const target = storage ?? window.localStorage;
    if (choice === 'system') {
      target.removeItem(THEME_STORAGE_KEY);
    } else {
      target.setItem(THEME_STORAGE_KEY, choice);
    }
  } catch {
    // Storage is blocked. The choice applies until the page is left.
  }
}

/**
 * Applies a choice to the page now. `system` removes the attribute, so the CSS follows the system.
 *
 * @param choice - The choice to apply.
 */
export function applyThemeChoice(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.dataset['theme'] = choice;
  }
}
