// useWizardConnections.test.tsx — Proves the Wizard connects ServiceNow on open, connects Jira on request, answers the
// launcher's "are you open?" check, and accepts a fresh token pushed from the ServiceNow tab.

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useConnectionStore } from '../../store/connectionStore.ts';
import { readJiraTransport, readSnowTransport, resetWizardTransports } from '../transport/wizardTransports.ts';
import { useWizardConnectionStore } from './wizardConnectionStore.ts';
import { useWizardConnections, type WizardAppDependencies } from './useWizardConnections.ts';

const BOOT = { instanceOrigin: 'https://acme.service-now.com', userToken: 'token-1', channelName: 'snowWizard' };

function createFakeChannelHub() {
  const listeners: Array<(messageEvent: MessageEvent) => void> = [];
  const posted: unknown[] = [];
  return {
    posted,
    deliver: (data: unknown) => listeners.forEach((listener) => listener(new MessageEvent('message', { data }))),
    createChannel: () => ({
      postMessage: (message: unknown) => posted.push(message),
      addEventListener: (_type: 'message', listener: (messageEvent: MessageEvent) => void) => listeners.push(listener),
      close: vi.fn(),
    }),
  };
}

function createDependencies(channelHub = createFakeChannelHub()): WizardAppDependencies {
  return {
    fetchFn: vi.fn(async () => new Response(JSON.stringify({ result: [{ name: 'Smith, Jane' }] }), { status: 200 })),
    createChannel: channelHub.createChannel,
    openWindow: vi.fn(() => null),
    listenerTarget: window,
    helloTimeoutMs: 50,
    requestTimeoutMs: 50,
    tokenTimeoutMs: 50,
  };
}

beforeEach(() => {
  useWizardConnectionStore.getState().resetConnections();
});

afterEach(() => {
  resetWizardTransports();
});

describe('useWizardConnections', () => {
  it('connects ServiceNow on open, installs the transport, and tells Toolbox\'s snowApi the relay is live', async () => {
    renderHook(() => useWizardConnections(BOOT, createDependencies()));

    await waitFor(() => expect(useWizardConnectionStore.getState().snow).toEqual({ status: 'connected', identity: 'Smith, Jane', detail: '' }));
    expect(readSnowTransport()).not.toBeNull();
    expect(readJiraTransport()).not.toBeNull();
    expect(useConnectionStore.getState().relayBridgeStatus).toEqual(expect.objectContaining({ system: 'snow', isConnected: true, hasSessionToken: true }));
  });

  it('reports why ServiceNow did not connect', async () => {
    const dependencies = createDependencies();
    dependencies.fetchFn = vi.fn(async () => new Response('', { status: 403 }));
    renderHook(() => useWizardConnections(BOOT, dependencies));
    await waitFor(() => expect(useWizardConnectionStore.getState().snow.status).toBe('notConnected'));
    expect(useWizardConnectionStore.getState().snow.detail).toContain('403');
  });

  it('marks Jira "connecting" then reports the reason when its tab never answers', async () => {
    const dependencies = createDependencies();
    const { result } = renderHook(() => useWizardConnections(BOOT, dependencies));

    act(() => { result.current.openJira('https://jira.example.com'); });
    expect(useWizardConnectionStore.getState().jira.status).toBe('connecting');
    expect(dependencies.openWindow).toHaveBeenCalledWith('https://jira.example.com', 'snowWizardJira');
    await waitFor(() => expect(useWizardConnectionStore.getState().jira.status).toBe('notConnected'));
    expect(useWizardConnectionStore.getState().jira.detail).toContain('no hello');
  });

  it('answers the launcher\'s ping and takes a pushed token, reviving an expired ServiceNow session', async () => {
    const channelHub = createFakeChannelHub();
    renderHook(() => useWizardConnections(BOOT, createDependencies(channelHub)));
    await waitFor(() => expect(useWizardConnectionStore.getState().snow.status).toBe('connected'));

    act(() => { channelHub.deliver({ kind: 'ping' }); });
    expect(channelHub.posted).toContainEqual({ kind: 'pong' });

    act(() => { useWizardConnectionStore.getState().setConnection('snow', { status: 'expired' }); });
    act(() => { channelHub.deliver({ kind: 'token', token: 'fresh' }); });
    expect(useWizardConnectionStore.getState().snow.status).toBe('connected');
  });
});
