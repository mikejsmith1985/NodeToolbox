// ConnectStep.test.tsx — Proves the Connect screen offers one Connect button per system and walks the user through the bookmark.

import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import ConnectStep from './ConnectStep.tsx';
import type { ConnectionState } from './wizardConnectionStore.ts';

const CONNECTED_SNOW: ConnectionState = { status: 'connected', identity: 'Smith, Jane', detail: '' };
const NOT_CONNECTED: ConnectionState = { status: 'notConnected', identity: '', detail: '' };
const CONNECTING: ConnectionState = { status: 'connecting', identity: '', detail: '' };
const SNOW_URL = 'https://acme.service-now.com';
const JIRA_URL = 'https://jira.example.com';

function renderConnectStep(overrides: Partial<ComponentProps<typeof ConnectStep>> = {}) {
  const handlers = { onConnectSnow: vi.fn(), onConnectJira: vi.fn(), onOpenSettings: vi.fn() };
  render(<ConnectStep snowState={NOT_CONNECTED} jiraState={NOT_CONNECTED} snowUrl={SNOW_URL} jiraUrl={JIRA_URL} {...handlers} {...overrides} />);
  return handlers;
}

describe('ConnectStep', () => {
  it('offers a Connect button for each system that is not connected yet', () => {
    const handlers = renderConnectStep();
    fireEvent.click(screen.getByRole('button', { name: 'Connect ServiceNow' }));
    fireEvent.click(screen.getByRole('button', { name: 'Connect Jira' }));
    expect(handlers.onConnectSnow).toHaveBeenCalledTimes(1);
    expect(handlers.onConnectJira).toHaveBeenCalledTimes(1);
  });

  it('hides the button of a connected system and names who is signed in', () => {
    renderConnectStep({ snowState: CONNECTED_SNOW });
    expect(screen.getByText(/ServiceNow: connected as Smith, Jane/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Connect ServiceNow' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Connect Jira' })).toBeTruthy();
  });

  it('while connecting, tells the user to click the bookmark in that tab and offers to open it again', () => {
    const handlers = renderConnectStep({ jiraState: CONNECTING });
    expect(screen.getByText(`In the Jira tab (${JIRA_URL}), sign in if asked, then click the SNow Wizard bookmark.`)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open Jira again' }));
    expect(handlers.onConnectJira).toHaveBeenCalled();
  });

  it('shows the reason when a system could not connect', () => {
    renderConnectStep({ jiraState: { status: 'notConnected', identity: '', detail: 'no hello within 180s' } });
    expect(screen.getByText(/no hello within 180s/)).toBeTruthy();
  });

  it('points to Settings for the bookmark', () => {
    const handlers = renderConnectStep();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(handlers.onOpenSettings).toHaveBeenCalled();
  });
});
