// ConnectionBanner.test.tsx — Proves the banner on every screen names both connections and offers the one fix for a lost one.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ConnectionBanner from './ConnectionBanner.tsx';
import type { ConnectionState } from './wizardConnectionStore.ts';

const CONNECTED_SNOW: ConnectionState = { status: 'connected', identity: 'Smith, Jane', detail: '' };
const EXPIRED: ConnectionState = { status: 'expired', identity: '', detail: 'Jira stopped answering' };

describe('ConnectionBanner', () => {
  it('reminds the user to keep ServiceNow open and names both connections', () => {
    render(<ConnectionBanner snowState={CONNECTED_SNOW} jiraState={{ status: 'connected', identity: 'Smith, Jane', detail: '' }} onOpenJira={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toContain('Keep your ServiceNow tab open');
    expect(screen.getByRole('status').textContent).toContain('Jira: connected');
  });

  it('turns to a warning with the one action that fixes a lost Jira tab', () => {
    const onOpenJira = vi.fn();
    render(<ConnectionBanner snowState={CONNECTED_SNOW} jiraState={EXPIRED} onOpenJira={onOpenJira} />);
    expect(screen.getByRole('status').getAttribute('data-tone')).toBe('warning');
    fireEvent.click(screen.getByRole('button', { name: 'Connect Jira again' }));
    expect(onOpenJira).toHaveBeenCalled();
  });

  it('tells the user how to fix an expired ServiceNow session', () => {
    render(<ConnectionBanner snowState={{ status: 'expired', identity: '', detail: '' }} jiraState={CONNECTED_SNOW} onOpenJira={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toContain('click the SNow Wizard bookmark on your ServiceNow tab again');
  });
});
