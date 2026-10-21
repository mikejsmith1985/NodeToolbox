// useWizardConnections.test.tsx — Proves Connect opens each system in its own named tab, marks it connected once the
// bookmark there answers, tells Toolbox's snowApi the relay is live, and turns a closed tab into "connect again".

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useConnectionStore } from '../../store/connectionStore.ts';
import { readJiraTransport, readSnowTransport, resetWizardTransports } from '../transport/wizardTransports.ts';
import { WIZARD_CHANNEL_NAME } from '../wizardDefaults.ts';
import { useWizardConnectionStore } from './wizardConnectionStore.ts';
import { useWizardConnections, type WizardAppDependencies } from './useWizardConnections.ts';

const SNOW_URL = 'https://acme.service-now.com';
const JIRA_URL = 'https://jira.example.com';
const SHORT_TIMEOUT_MS = 50;

interface FakeAgentTab {
  closed: boolean;
  postMessage: (message: { kind: string; requestId: string; path: string }) => void;
}

/** A tab running the relay bookmark: says hello for its system, then answers the identity read with `identityBody`. */
function createFakeAgentTab(system: 'snow' | 'jira', origin: string, identityStatus: number, identityBody: string) {
  const fakeTab: FakeAgentTab = {
    closed: false,
    postMessage(message) {
      if (message.kind !== 'request') return;
      setTimeout(() => window.dispatchEvent(new MessageEvent('message', {
        data: { channel: WIZARD_CHANNEL_NAME, kind: 'response', requestId: message.requestId, status: identityStatus, body: identityBody },
        origin,
        source: fakeTab as unknown as MessageEventSource,
      })), 0);
    },
  };
  const sayHello = () => window.dispatchEvent(new MessageEvent('message', {
    data: { channel: WIZARD_CHANNEL_NAME, kind: 'hello', system },
    origin,
    source: fakeTab as unknown as MessageEventSource,
  }));
  return { fakeTab, sayHello };
}

/** Opens fake tabs that answer as signed in, unless a system is listed in `silentSystems` (its tab never says hello). */
function createDependencies(options: { snowIdentityStatus?: number; silentSystems?: string[] } = {}) {
  const snowAgentTab = createFakeAgentTab('snow', SNOW_URL, options.snowIdentityStatus ?? 200, '{"result":[{"name":"Smith, Jane"}]}');
  const jiraAgentTab = createFakeAgentTab('jira', JIRA_URL, 200, '{"displayName":"Smith, Jane (CTR)"}');
  const openWindow = vi.fn((url: string) => {
    const agentTab = url.startsWith(SNOW_URL) ? snowAgentTab : jiraAgentTab;
    const isSilent = (options.silentSystems ?? []).includes(url.startsWith(SNOW_URL) ? 'snow' : 'jira');
    if (!isSilent) setTimeout(agentTab.sayHello, 0);
    return agentTab.fakeTab as unknown as Window;
  });
  const dependencies: WizardAppDependencies = { openWindow, listenerTarget: window, helloTimeoutMs: SHORT_TIMEOUT_MS, requestTimeoutMs: SHORT_TIMEOUT_MS };
  return { dependencies, openWindow, snowAgentTab, jiraAgentTab };
}

beforeEach(() => {
  useWizardConnectionStore.getState().resetConnections();
  useConnectionStore.setState({ relayBridgeStatus: null });
});

afterEach(() => {
  resetWizardTransports();
});

describe('useWizardConnections', () => {
  it('installs both connections for Toolbox\'s snowApi and jiraApi but opens nothing until Connect is pressed', () => {
    const { dependencies, openWindow } = createDependencies();
    renderHook(() => useWizardConnections(dependencies));
    expect(readSnowTransport()).not.toBeNull();
    expect(readJiraTransport()).not.toBeNull();
    expect(openWindow).not.toHaveBeenCalled();
    expect(useWizardConnectionStore.getState().snow.status).toBe('notConnected');
  });

  it('connects ServiceNow through its named tab and tells Toolbox\'s snowApi the relay is live', async () => {
    const { dependencies, openWindow } = createDependencies();
    const { result } = renderHook(() => useWizardConnections(dependencies));

    act(() => { result.current.connectSnow(SNOW_URL); });
    expect(useWizardConnectionStore.getState().snow.status).toBe('connecting');
    expect(openWindow).toHaveBeenCalledWith(SNOW_URL, expect.stringMatching(/^snowWizardServiceNow-/));

    await waitFor(() => expect(useWizardConnectionStore.getState().snow).toEqual({ status: 'connected', identity: 'Smith, Jane', detail: '' }));
    expect(useConnectionStore.getState().relayBridgeStatus).toEqual(expect.objectContaining({ system: 'snow', isConnected: true, hasSessionToken: true }));
    expect(useWizardConnectionStore.getState().jira.status).toBe('notConnected');
  });

  it('connects Jira through its own named tab, reading the signed-in name', async () => {
    const { dependencies, openWindow } = createDependencies();
    const { result } = renderHook(() => useWizardConnections(dependencies));

    act(() => { result.current.connectJira(JIRA_URL); });

    expect(openWindow).toHaveBeenCalledWith(JIRA_URL, expect.stringMatching(/^snowWizardJira-/));
    await waitFor(() => expect(useWizardConnectionStore.getState().jira).toEqual({ status: 'connected', identity: 'Smith, Jane (CTR)', detail: '' }));
    expect(useConnectionStore.getState().relayBridgeStatus).toBeNull();
  });

  it('reports why ServiceNow did not connect', async () => {
    const { dependencies } = createDependencies({ snowIdentityStatus: 403 });
    const { result } = renderHook(() => useWizardConnections(dependencies));
    act(() => { result.current.connectSnow(SNOW_URL); });
    await waitFor(() => expect(useWizardConnectionStore.getState().snow.status).toBe('notConnected'));
    expect(useWizardConnectionStore.getState().snow.detail).toContain('ServiceNow answered 403');
  });

  it('reports the reason when the tab never answers (bookmark not clicked)', async () => {
    const { dependencies } = createDependencies({ silentSystems: ['jira'] });
    const { result } = renderHook(() => useWizardConnections(dependencies));
    act(() => { result.current.connectJira(JIRA_URL); });
    await waitFor(() => expect(useWizardConnectionStore.getState().jira.status).toBe('notConnected'));
    expect(useWizardConnectionStore.getState().jira.detail).toContain('no hello');
  });

  it('marks ServiceNow "needs reconnecting" and the Toolbox relay down when its tab is closed', async () => {
    const { dependencies, snowAgentTab } = createDependencies();
    const { result } = renderHook(() => useWizardConnections(dependencies));
    act(() => { result.current.connectSnow(SNOW_URL); });
    await waitFor(() => expect(useWizardConnectionStore.getState().snow.status).toBe('connected'));

    snowAgentTab.fakeTab.closed = true;
    const relayResult = await readSnowTransport()?.execute({ sys: 'snow', id: 'r1', method: 'GET', path: '/api/now/table/x' });

    expect(relayResult).toEqual(expect.objectContaining({ ok: false, status: 0, error: 'The ServiceNow tab was closed' }));
    expect(useWizardConnectionStore.getState().snow).toEqual({ status: 'expired', identity: '', detail: 'The ServiceNow tab was closed.' });
    expect(useConnectionStore.getState().relayBridgeStatus).toEqual(expect.objectContaining({ isConnected: false }));
  });

  it('marks Jira "needs reconnecting" when its tab is closed, leaving ServiceNow alone', async () => {
    const { dependencies, jiraAgentTab } = createDependencies();
    const { result } = renderHook(() => useWizardConnections(dependencies));
    act(() => { result.current.connectJira(JIRA_URL); });
    await waitFor(() => expect(useWizardConnectionStore.getState().jira.status).toBe('connected'));

    jiraAgentTab.fakeTab.closed = true;
    await readJiraTransport()?.execute({ method: 'GET', path: '/rest/api/2/myself' });

    expect(useWizardConnectionStore.getState().jira).toEqual({ status: 'expired', identity: '', detail: 'The Jira tab was closed.' });
    expect(useWizardConnectionStore.getState().snow.status).toBe('notConnected');
  });
});
