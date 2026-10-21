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
    expect(screen.getByRole('button', { name: 'Connect Jira' })).toBeTruthy();
    // Until Jira answers, Connect is the only thing to do: the job choices are not shown at all.
    expect(screen.queryByText('What would you like to do?')).toBeNull();
    expect(screen.getByText('SNow Wizard v0.304.0')).toBeTruthy();
  });

  it('hides Connect once both systems are connected', async () => {
    render(<WizardApp boot={BOOT} dependencies={createDependencies()} appVersion="v1" />);
    await waitFor(() => expect(useWizardConnectionStore.getState().snow.status).toBe('connected'));
    useWizardConnectionStore.getState().setConnection('jira', { status: 'connected', identity: 'Smith, Jane' });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Connect Jira' })).toBeNull());
  });

  it('opens each job from Home once both systems are connected, and every job leads back home', async () => {
    render(<WizardApp boot={BOOT} dependencies={createDependencies()} appVersion="v1" />);
    await waitFor(() => expect(useWizardConnectionStore.getState().snow.status).toBe('connected'));
    useWizardConnectionStore.getState().setConnection('jira', { status: 'connected', identity: 'Smith, Jane' });
    const firstScreenByJob: ReadonlyArray<[string, RegExp]> = [
      ['Make or change a change', /^Create a new change$/],
      ['Turn a problem into Jira work', /Step 1 of/],
      ['Review a change', /Step 1 of/],
    ];
    for (const [jobTitle, firstScreenText] of firstScreenByJob) {
      fireEvent.click(await screen.findByRole('button', { name: new RegExp(jobTitle) }));
      expect(await screen.findByText(firstScreenText)).toBeTruthy();
      expect(document.body.textContent).not.toMatch(INTERNAL_NAME_PATTERN);
      fireEvent.click(screen.getAllByRole('button', { name: /home/i })[0]);
      expect(await screen.findByText('What would you like to do?')).toBeTruthy();
    }
  });

  it('opens Settings before connecting and goes back to Connect', async () => {
    render(<WizardApp boot={BOOT} dependencies={createDependencies()} appVersion="v1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByLabelText('Jira address')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to home' }));
    expect(screen.getByRole('button', { name: 'Connect Jira' })).toBeTruthy();
  });

  it('opens Settings from Home once connected, and tells the user to keep the window open', async () => {
    render(<WizardApp boot={BOOT} dependencies={createDependencies()} appVersion="v1" />);
    await waitFor(() => expect(useWizardConnectionStore.getState().snow.status).toBe('connected'));
    useWizardConnectionStore.getState().setConnection('jira', { status: 'connected', identity: 'Smith, Jane' });
    expect(await screen.findByText(/keep this window open while you work/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
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
