// jiraOpenerTransport.test.ts — Proves the Wizard connects to the Jira tab it opened, trusts only the configured Jira,
// and reports a lost Jira tab instead of hanging.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createJiraOpenerTransport } from './jiraOpenerTransport.ts';

const CHANNEL_NAME = 'snowWizard';
const JIRA_URL = 'https://jira.example.com/secure/Dashboard.jspa';
const JIRA_ORIGIN = 'https://jira.example.com';

function createAnsweringAgent(status: number, body: string) {
  return {
    postMessage: vi.fn((message: { requestId: string }) => queueMicrotask(() => window.dispatchEvent(new MessageEvent('message', {
      data: { channel: CHANNEL_NAME, kind: 'response', requestId: message.requestId, status, body },
      origin: JIRA_ORIGIN,
    })))),
  };
}

function sayHello(agentWindow: unknown, origin = JIRA_ORIGIN): void {
  window.dispatchEvent(new MessageEvent('message', {
    data: { channel: CHANNEL_NAME, kind: 'hello', system: 'jira' },
    origin,
    source: agentWindow as MessageEventSource,
  }));
}

function createTransport(onDisconnected = vi.fn()) {
  const openWindow = vi.fn(() => null);
  const transport = createJiraOpenerTransport({
    listenerTarget: window,
    openWindow,
    channelName: CHANNEL_NAME,
    helloTimeoutMs: 1000,
    requestTimeoutMs: 1000,
    onDisconnected,
  });
  return { transport, openWindow, onDisconnected };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createJiraOpenerTransport', () => {
  it('opens Jira, waits for the agent, and confirms who is signed in', async () => {
    const { transport, openWindow } = createTransport();
    const connectPromise = transport.connect(JIRA_URL);
    sayHello(createAnsweringAgent(200, '{"displayName":"Smith, Jane"}'));

    await expect(connectPromise).resolves.toEqual({ displayName: 'Smith, Jane' });
    expect(openWindow).toHaveBeenCalledWith(JIRA_URL, 'snowWizardJira');
    expect(transport.isConnected()).toBe(true);
  });

  it('ignores a hello from any origin other than the configured Jira', async () => {
    vi.useFakeTimers();
    const { transport } = createTransport();
    const connectPromise = transport.connect(JIRA_URL);
    sayHello(createAnsweringAgent(200, '{}'), 'https://evil.example.com');
    vi.advanceTimersByTime(1001);
    await expect(connectPromise).rejects.toThrow('no hello');
    expect(transport.isConnected()).toBe(false);
  });

  it('fails the connection when Jira does not confirm the user', async () => {
    const { transport } = createTransport();
    const connectPromise = transport.connect(JIRA_URL);
    sayHello(createAnsweringAgent(401, ''));
    await expect(connectPromise).rejects.toThrow('Jira answered 401');
    expect(transport.isConnected()).toBe(false);
  });

  it('answers status 0 without sending anything while not connected', async () => {
    const { transport } = createTransport();
    await expect(transport.execute({ method: 'GET', path: '/rest/api/2/myself' })).resolves.toEqual({ status: 0, body: 'Jira is not connected' });
  });

  it('marks Jira disconnected and tells the Wizard when a request times out', async () => {
    const { transport, onDisconnected } = createTransport();
    const connectPromise = transport.connect(JIRA_URL);
    const agentWindow = createAnsweringAgent(200, '{"displayName":"A"}');
    sayHello(agentWindow);
    await connectPromise;

    agentWindow.postMessage.mockImplementation(() => undefined);
    vi.useFakeTimers();
    const responsePromise = transport.execute({ method: 'GET', path: '/rest/api/2/issue/X-1' });
    vi.advanceTimersByTime(1001);

    await expect(responsePromise).resolves.toEqual({ status: 0, body: 'timeout' });
    expect(transport.isConnected()).toBe(false);
    expect(onDisconnected).toHaveBeenCalled();
  });

  it('gives a file download longer than an ordinary request before giving up', async () => {
    const { transport } = createTransport();
    const connectPromise = transport.connect(JIRA_URL);
    const agentWindow = createAnsweringAgent(200, '{"displayName":"A"}');
    sayHello(agentWindow);
    await connectPromise;

    let lastRequestId = '';
    agentWindow.postMessage.mockImplementation((message: { requestId: string }) => { lastRequestId = message.requestId; });
    vi.useFakeTimers();
    const responsePromise = transport.execute({ method: 'GET', path: '/secure/attachment/1/a.pdf', responseEncoding: 'base64' });
    vi.advanceTimersByTime(5000);
    window.dispatchEvent(new MessageEvent('message', {
      data: { channel: CHANNEL_NAME, kind: 'response', requestId: lastRequestId, status: 200, body: 'AQI=', bodyEncoding: 'base64' },
      origin: JIRA_ORIGIN,
    }));

    await expect(responsePromise).resolves.toEqual({ status: 200, body: 'AQI=', bodyEncoding: 'base64' });
    expect(transport.isConnected()).toBe(true);
  });
});
