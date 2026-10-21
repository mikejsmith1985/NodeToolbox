// ConnectionBanner.test.tsx — Proves the banner on every screen names both connections and offers the one fix for a lost one.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ConnectionBanner from './ConnectionBanner.tsx';
import type { ConnectionState } from './wizardConnectionStore.ts';

const CONNECTED: ConnectionState = { status: 'connected', identity: 'Smith, Jane', detail: '' };
const EXPIRED: ConnectionState = { status: 'expired', identity: '', detail: 'The Jira tab was closed.' };

describe('ConnectionBanner', () => {
  it('names both connections and reminds the user to keep both tabs open', () => {
    render(<ConnectionBanner snowState={CONNECTED} jiraState={CONNECTED} onConnectSnow={vi.fn()} onConnectJira={vi.fn()} />);
    const bannerText = screen.getByRole('status').textContent;
    expect(bannerText).toContain('ServiceNow: connected as Smith, Jane');
    expect(bannerText).toContain('Jira: connected as Smith, Jane');
    expect(bannerText).toContain('Keep the ServiceNow and Jira tabs open');
    expect(screen.getByRole('status').getAttribute('data-tone')).toBe('ok');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('turns to a warning with the one action that fixes a lost Jira tab', () => {
    const onConnectJira = vi.fn();
    const onConnectSnow = vi.fn();
    render(<ConnectionBanner snowState={CONNECTED} jiraState={EXPIRED} onConnectSnow={onConnectSnow} onConnectJira={onConnectJira} />);
    expect(screen.getByRole('status').getAttribute('data-tone')).toBe('warning');
    expect(screen.queryByRole('button', { name: 'Connect ServiceNow again' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Connect Jira again' }));
    expect(onConnectJira).toHaveBeenCalled();
    expect(onConnectSnow).not.toHaveBeenCalled();
  });

  it('offers to connect ServiceNow again when its tab is lost', () => {
    const onConnectSnow = vi.fn();
    render(<ConnectionBanner snowState={EXPIRED} jiraState={CONNECTED} onConnectSnow={onConnectSnow} onConnectJira={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toContain('ServiceNow: needs reconnecting');
    fireEvent.click(screen.getByRole('button', { name: 'Connect ServiceNow again' }));
    expect(onConnectSnow).toHaveBeenCalled();
  });
});
