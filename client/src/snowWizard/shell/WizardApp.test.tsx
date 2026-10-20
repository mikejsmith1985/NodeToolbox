// WizardApp.test.tsx — Proves the Wizard window assembles its frame, and that no screen ever shows an internal field
// name (the "a small child could follow it" rule, wizard-shell.md).

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetWizardTransports } from '../transport/wizardTransports.ts';
import WizardApp from './WizardApp.tsx';
import { useWizardConnectionStore } from './wizardConnectionStore.ts';
import type { WizardAppDependencies } from './useWizardConnections.ts';

/** Text a user should never see: ServiceNow/Jira internal names. */
const INTERNAL_NAME_PATTERN = /\bu_[a-z]|cmdb_ci|customfield_|sys_id/i;
const BOOT = { instanceOrigin: 'https://acme.service-now.com', userToken: 't', channelName: 'snowWizard' };

function createDependencies(): WizardAppDependencies {
  return {
    fetchFn: vi.fn(async () => new Response(JSON.stringify({ result: [{ name: 'Smith, Jane' }] }), { status: 200 })),
    createChannel: () => ({ postMessage: vi.fn(), addEventListener: vi.fn(), close: vi.fn() }),
    openWindow: vi.fn(() => null),
    listenerTarget: window,
    helloTimeoutMs: 50,
    requestTimeoutMs: 50,
    tokenTimeoutMs: 50,
  };
}

beforeEach(() => {
  useWizardConnectionStore.getState().resetConnections();
  localStorage.clear();
});

afterEach(() => {
  resetWizardTransports();
});

describe('WizardApp', () => {
  it('connects ServiceNow, shows Connect for Jira, and keeps the jobs closed', async () => {
    render(<WizardApp boot={BOOT} dependencies={createDependencies()} appVersion="v0.304.0" />);
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('ServiceNow: connected as Smith, Jane'));
    expect(screen.getByRole('button', { name: 'Open Jira' })).toBeTruthy();
    expect(screen.getAllByText('Connect ServiceNow and Jira first').length).toBe(3);
    expect(screen.getByText('SNow Wizard v0.304.0')).toBeTruthy();
  });

  it('hides Connect once both systems are connected', async () => {
    render(<WizardApp boot={BOOT} dependencies={createDependencies()} appVersion="v1" />);
    await waitFor(() => expect(useWizardConnectionStore.getState().snow.status).toBe('connected'));
    useWizardConnectionStore.getState().setConnection('jira', { status: 'connected', identity: 'Smith, Jane' });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Open Jira' })).toBeNull());
  });

  it('opens Settings from Home and goes back', async () => {
    render(<WizardApp boot={BOOT} dependencies={createDependencies()} appVersion="v1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByLabelText('Jira address')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to home' }));
    expect(screen.getByText('What would you like to do?')).toBeTruthy();
  });

  it('never shows an internal field name on any frame screen', async () => {
    render(<WizardApp boot={BOOT} dependencies={createDependencies()} appVersion="v1" />);
    await waitFor(() => expect(useWizardConnectionStore.getState().snow.status).toBe('connected'));
    expect(document.body.textContent).not.toMatch(INTERNAL_NAME_PATTERN);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(document.body.textContent).not.toMatch(INTERNAL_NAME_PATTERN);
  });
});
