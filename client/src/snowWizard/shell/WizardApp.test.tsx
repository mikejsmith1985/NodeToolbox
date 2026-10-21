// WizardApp.test.tsx — Proves the Wizard page assembles its frame, connects each system from its Connect button, keeps
// the jobs closed until both answer, reconnects a changed address, and never shows an internal field name (the "a small
// child could follow it" rule, wizard-shell.md).

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetWizardTransports } from '../transport/wizardTransports.ts';
import { WIZARD_CHANNEL_NAME } from '../wizardDefaults.ts';
import WizardApp from './WizardApp.tsx';
import { useWizardConnectionStore } from './wizardConnectionStore.ts';
import { JIRA_URL_STORAGE_KEY, SNOW_URL_STORAGE_KEY } from './wizardSettings.ts';
import type { WizardAppDependencies } from './useWizardConnections.ts';

/** Text a user should never see: ServiceNow/Jira internal names. */
const INTERNAL_NAME_PATTERN = /\bu_[a-z]|cmdb_ci|customfield_|sys_id/i;
const SNOW_URL = 'https://acme.service-now.com';
const JIRA_URL = 'https://jira.example.com';
const SHORT_TIMEOUT_MS = 50;

/** Opens a fake tab per system that says hello and answers the identity read as Smith, Jane. */
function createDependencies(): WizardAppDependencies & { openWindow: ReturnType<typeof vi.fn> } {
  const openWindow = vi.fn((url: string) => {
    const systemOrigin = new URL(url).origin;
    const system = systemOrigin === SNOW_URL ? 'snow' : 'jira';
    const identityBody = system === 'snow' ? '{"result":[{"name":"Smith, Jane"}]}' : '{"displayName":"Smith, Jane"}';
    const fakeTab = {
      closed: false,
      postMessage(message: { kind: string; requestId: string }) {
        if (message.kind !== 'request') return;
        setTimeout(() => window.dispatchEvent(new MessageEvent('message', {
          data: { channel: WIZARD_CHANNEL_NAME, kind: 'response', requestId: message.requestId, status: 200, body: identityBody },
          origin: systemOrigin,
          source: fakeTab as unknown as MessageEventSource,
        })), 0);
      },
    };
    setTimeout(() => window.dispatchEvent(new MessageEvent('message', {
      data: { channel: WIZARD_CHANNEL_NAME, kind: 'hello', system },
      origin: systemOrigin,
      source: fakeTab as unknown as MessageEventSource,
    })), 0);
    return fakeTab as unknown as Window;
  });
  return { openWindow, listenerTarget: window, helloTimeoutMs: SHORT_TIMEOUT_MS, requestTimeoutMs: SHORT_TIMEOUT_MS };
}

function connectBoth(): void {
  useWizardConnectionStore.getState().setConnection('snow', { status: 'connected', identity: 'Smith, Jane' });
  useWizardConnectionStore.getState().setConnection('jira', { status: 'connected', identity: 'Smith, Jane' });
}

beforeEach(() => {
  useWizardConnectionStore.getState().resetConnections();
  localStorage.clear();
  localStorage.setItem(SNOW_URL_STORAGE_KEY, SNOW_URL);
  localStorage.setItem(JIRA_URL_STORAGE_KEY, JIRA_URL);
});

afterEach(() => {
  resetWizardTransports();
});

describe('WizardApp', () => {
  it('starts on Connect with both systems not connected, the jobs closed, and the version shown', () => {
    const dependencies = createDependencies();
    render(<WizardApp dependencies={dependencies} appVersion="v0.317.0" />);
    expect(screen.getByText('Connect to ServiceNow and Jira')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Connect ServiceNow' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Connect Jira' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Make or change a change/ })[0].hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('SNow Wizard v0.317.0')).toBeTruthy();
    expect(dependencies.openWindow).not.toHaveBeenCalled();
  });

  it('connects each system from its button using the saved address, then hides Connect', async () => {
    const dependencies = createDependencies();
    render(<WizardApp dependencies={dependencies} appVersion="v1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Connect ServiceNow' }));
    expect(dependencies.openWindow).toHaveBeenCalledWith(SNOW_URL, expect.stringMatching(/^snowWizardServiceNow-/));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('ServiceNow: connected as Smith, Jane'));

    fireEvent.click(screen.getByRole('button', { name: 'Connect Jira' }));
    expect(dependencies.openWindow).toHaveBeenCalledWith(JIRA_URL, expect.stringMatching(/^snowWizardJira-/));
    await waitFor(() => expect(screen.queryByText('Connect to ServiceNow and Jira')).toBeNull());
    expect(screen.getAllByRole('button', { name: /Make or change a change/ })[0].hasAttribute('disabled')).toBe(false);
  });

  it('opens each job from Home once both systems are connected, and every job leads back home', async () => {
    render(<WizardApp dependencies={createDependencies()} appVersion="v1" />);
    connectBoth();
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

  it('offers "connect again" in the banner when a tab is lost, even inside a job', async () => {
    const dependencies = createDependencies();
    render(<WizardApp dependencies={dependencies} appVersion="v1" />);
    connectBoth();
    fireEvent.click(await screen.findByRole('button', { name: /Review a change/ }));
    useWizardConnectionStore.getState().setConnection('jira', { status: 'expired', detail: 'The Jira tab was closed.' });

    fireEvent.click(await screen.findByRole('button', { name: 'Connect Jira again' }));

    expect(dependencies.openWindow).toHaveBeenCalledWith(JIRA_URL, expect.stringMatching(/^snowWizardJira-/));
    expect(screen.getAllByText(/Step 1 of/).length).toBeGreaterThan(0);
  });

  it('opens Settings from Connect and goes back to Connect', () => {
    render(<WizardApp dependencies={createDependencies()} appVersion="v1" />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]);
    expect(screen.getByLabelText('Jira address')).toBeTruthy();
    expect(screen.queryByText('Connect to ServiceNow and Jira')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Connect to ServiceNow and Jira')).toBeTruthy();
  });

  it('reconnects only the address that changed when Settings are saved', () => {
    const dependencies = createDependencies();
    render(<WizardApp dependencies={dependencies} appVersion="v1" />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]);

    fireEvent.change(screen.getByLabelText('Jira address'), { target: { value: 'https://jira-new.example.com/' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save addresses' }));

    expect(dependencies.openWindow).toHaveBeenCalledTimes(1);
    expect(dependencies.openWindow).toHaveBeenCalledWith('https://jira-new.example.com', expect.stringMatching(/^snowWizardJira-/));
    expect(localStorage.getItem(JIRA_URL_STORAGE_KEY)).toBe('https://jira-new.example.com');
    expect(screen.getByText(/Jira: saved — reconnecting\./)).toBeTruthy();
  });

  it('tells the user to keep the page and its tabs open once connected', async () => {
    render(<WizardApp dependencies={createDependencies()} appVersion="v1" />);
    connectBoth();
    expect(await screen.findByText(/keep this page and its ServiceNow and Jira tabs open/i)).toBeTruthy();
  });

  it('never shows an internal field name on any frame screen', () => {
    render(<WizardApp dependencies={createDependencies()} appVersion="v1" />);
    expect(document.body.textContent).not.toMatch(INTERNAL_NAME_PATTERN);
    fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]);
    expect(document.body.textContent).not.toMatch(INTERNAL_NAME_PATTERN);
  });
});
