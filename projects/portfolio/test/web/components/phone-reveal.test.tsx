import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PhoneReveal } from '../../../web/components/phone-reveal';
import { encodePhone } from '../../../web/lib/phone-token';

const PHONE = { display: '+1 (555) 010-0100', href: 'tel:+15550100100' };

/**
 * Renders the control inside its list, as the contact section does.
 *
 * @returns The render result.
 */
function renderReveal(): ReturnType<typeof render> {
  return render(
    <ul>
      <PhoneReveal token={encodePhone(PHONE)} />
    </ul>,
  );
}

describe('PhoneReveal', () => {
  it('shows only the button before the click, with aria-expanded false', () => {
    const { container } = renderReveal();

    const button = screen.getByRole('button', { name: 'Show phone number' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(container.textContent).not.toContain('010-0100');
    expect(screen.queryByRole('link')).toBeNull();
    expect(container.querySelector('a[href^="tel:"]')).toBeNull();
  });

  it('shows the tel link with the number after the click, and sets aria-expanded true', () => {
    renderReveal();
    const button = screen.getByRole('button', { name: 'Show phone number' });

    fireEvent.click(button);

    const link = screen.getByRole('link', { name: PHONE.display });
    expect(link).toHaveAttribute('href', PHONE.href);
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  it('points aria-controls at a polite live region that holds the link', () => {
    renderReveal();
    const button = screen.getByRole('button', { name: 'Show phone number' });
    const regionId = button.getAttribute('aria-controls');
    expect(regionId).toBeTruthy();

    const region = document.getElementById(regionId ?? '');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveTextContent('');

    fireEvent.click(button);

    expect(region).toContainElement(screen.getByRole('link', { name: PHONE.display }));
  });

  it('keeps one link after a second click', () => {
    renderReveal();
    const button = screen.getByRole('button', { name: 'Show phone number' });

    fireEvent.click(button);
    fireEvent.click(button);

    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('renders no href when the decoded href does not start with tel:', () => {
    render(
      <ul>
        <PhoneReveal token={encodePhone({ display: 'Call me', href: 'javascript:alert(1)' })} />
      </ul>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Show phone number' }));

    expect(screen.getByText('Call me')).not.toHaveAttribute('href');
  });
});
