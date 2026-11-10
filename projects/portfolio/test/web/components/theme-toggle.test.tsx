import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ThemeToggle } from '../../../web/components/theme-toggle';
import { THEME_STORAGE_KEY } from '../../../web/lib/theme';

const root = (): HTMLElement => document.documentElement;

describe('ThemeToggle', () => {
  beforeEach(() => {
    root().removeAttribute('data-theme');
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    root().removeAttribute('data-theme');
    window.localStorage.clear();
  });

  it('renders the three states in a labelled group', () => {
    render(<ThemeToggle />);

    const group = screen.getByRole('group', { name: 'Theme' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'System' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('applies the picked theme at once and keeps it in local storage', () => {
    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
    expect(root()).toHaveAttribute('data-theme', 'dark');
    expect(screen.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    fireEvent.click(screen.getByRole('button', { name: 'Light' }));
    expect(root()).toHaveAttribute('data-theme', 'light');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('removes the attribute and the stored key for system', () => {
    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
    fireEvent.click(screen.getByRole('button', { name: 'System' }));

    expect(root()).not.toHaveAttribute('data-theme');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(screen.getByRole('button', { name: 'System' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows the stored choice after it mounts', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    render(<ThemeToggle />);

    expect(screen.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'System' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('still applies the choice when local storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage is blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage is blocked');
    });
    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole('button', { name: 'Dark' }));

    expect(root()).toHaveAttribute('data-theme', 'dark');
    expect(screen.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true');
  });
});
