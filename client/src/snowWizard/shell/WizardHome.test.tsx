// WizardHome.test.tsx — Proves Home offers the three jobs and holds them until ServiceNow and Jira are connected.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import WizardHome from './WizardHome.tsx';

describe('WizardHome', () => {
  it('offers the three jobs, held until both systems are connected', () => {
    render(<WizardHome isReady={false} onOpenSettings={vi.fn()} />);
    expect(screen.getByText('Make or change a change')).toBeTruthy();
    expect(screen.getByText('Turn a problem into Jira work')).toBeTruthy();
    expect(screen.getByText('Review a change')).toBeTruthy();
    expect(screen.getAllByText('Connect ServiceNow and Jira first').length).toBe(3);
  });

  it('opens Settings', () => {
    const onOpenSettings = vi.fn();
    render(<WizardHome isReady onOpenSettings={onOpenSettings} />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(onOpenSettings).toHaveBeenCalled();
  });
});
