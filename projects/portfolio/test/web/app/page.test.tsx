import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import HomePage from '../../../web/app/page';
import { content } from '../../../web/lib/content';

describe('HomePage', () => {
  it('shows the headline from the content', () => {
    render(<HomePage />);

    expect(
      screen.getByRole('heading', { level: 1, name: content.profile.name }),
    ).toBeInTheDocument();
  });
});
