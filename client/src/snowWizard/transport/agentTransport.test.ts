// agentTransport.test.ts — Proves one connection opens its system's named tab, trusts only that system's hello from that
// address, confirms who is signed in, and reports a closed or silent tab instead of hanging.

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgentRequest } from './agentChannel.ts';
import { createAgentTransport, TAB_CHECK_INTERVAL_MS, type AgentTransportOptions } from './agentTransport.ts';

const CHANNEL_NAME = 'snowWizard';
const JIRA_URL = 'https://jira.example.com/jira';
const JIRA_ORIGIN = 'https://jira.example.com';
const IDENTITY_PATH = '/rest/api/2/myself';
const SHORT_TIMEOUT_MS = 50;
/** Longer than an ordinary request may wait in these tests, far shorter than a file transfer may. */
const SLOW_ANSWER_DELAY_MS = 150;

type AnswerRequest = (agentRequest: AgentRequest) => { status: number; body: string; delayMs?: number } | null;

/** A stand-in for the system's tab running the relay bookmark: it answers the Wizard's requests on the channel. */
function createFakeAgentTab(answerRequest: AnswerRequest) {
  const receivedRequests: AgentRequest[] = [];
  const fakeTab = {
    closed: false,
    postMessage(message: AgentRequest & { kind: string; requestId: string }) {
      if (message.kind !== 'request') return;
      receivedRequests.push(message);
      const answer = answerRequest(message);
      if (!answer) return;
      setTimeout(() => window.dispatchEvent(new MessageEvent('message', {
        data: { channel: CHANNEL_NAME, kind: 'response', requestId: message.requestId, status: answer.status, body: answer.body },
        origin: JIRA_ORIGIN,
        source: fakeTab as unknown as MessageEventSource,
      })), answer.delayMs ?? 0);
    },
  };
  const sayHello = (system = 'jira', origin = JIRA_ORIGIN) => window.dispatchEvent(new MessageEvent('message', {
    data: { channel: CHANNEL_NAME, kind: 'hello', system },
    origin,
    source: fakeTab as unknown as MessageEventSource,
  }));
  return { fakeTab, receivedRequests, sayHello };
}

const answerIdentity: AnswerRequest = (agentRequest) => (agentRequest.path === IDENTITY_PATH
  ? { status: 200, body: '{"displayName":"Smith, Jane"}' }
  : { status: 200, body: 'ok' });

function createJiraTransport(fakeAgentTab: ReturnType<typeof createFakeAgentTab>, overrides: Partial<AgentTransportOptions> = {}) {
  const onDisconnected = vi.fn();
  const openWindow = vi.fn(() => {
    setTimeout(() => fakeAgentTab.sayHello(), 0);
    return fakeAgentTab.fakeTab as unknown as Window;
  });
  const agentTransport = createAgentTransport({
    system: 'jira',
    systemLabel: 'Jira',
    windowName: 'snowWizardJira',
    identityPath: IDENTITY_PATH,
    readIdentity: (responseBody) => String((JSON.parse(responseBody) as { displayName?: string }).displayName ?? ''),
    listenerTarget: window,
    openWindow,
    channelName: CHANNEL_NAME,
    helloTimeoutMs: SHORT_TIMEOUT_MS,
    requestTimeoutMs: SHORT_TIMEOUT_MS,
    onDisconnected,
    ...overrides,
  });
  return { agentTransport, openWindow, onDisconnected };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createAgentTransport', () => {
  it('opens the system in its named tab, waits for its hello, and reads who is signed in', async () => {
    const fakeAgentTab = createFakeAgentTab(answerIdentity);
    const { agentTransport, openWindow } = createJiraTransport(fakeAgentTab);
    expect(agentTransport.isConnected()).toBe(false);

    await expect(agentTransport.connect(JIRA_URL)).resolves.toEqual({ displayName: 'Smith, Jane' });

    expect(openWindow).toHaveBeenCalledWith(JIRA_URL, 'snowWizardJira');
    expect(fakeAgentTab.receivedRequests).toEqual([expect.objectContaining({ method: 'GET', path: IDENTITY_PATH })]);
    expect(agentTransport.isConnected()).toBe(true);
  });

  it('runs requests in the connected tab once connected', async () => {
    const fakeAgentTab = createFakeAgentTab(answerIdentity);
    const { agentTransport } = createJiraTransport(fakeAgentTab);
    await agentTransport.connect(JIRA_URL);
    await expect(agentTransport.execute({ method: 'GET', path: '/rest/api/2/issue/A-1' })).resolves.toEqual({ status: 200, body: 'ok' });
  });

  it('ignores a hello from the other system or from another address, and gives up when none fits', async () => {
    const fakeAgentTab = createFakeAgentTab(answerIdentity);
    const openWindow = vi.fn(() => {
      setTimeout(() => {
        fakeAgentTab.sayHello('snow', JIRA_ORIGIN);
        fakeAgentTab.sayHello('jira', 'https://evil.example.com');
      }, 0);
      return fakeAgentTab.fakeTab as unknown as Window;
    });
    const { agentTransport } = createJiraTransport(fakeAgentTab, { openWindow });

    await expect(agentTransport.connect(JIRA_URL)).rejects.toThrow('no hello');
    expect(fakeAgentTab.receivedRequests).toHaveLength(0);
    expect(agentTransport.isConnected()).toBe(false);
  });

  it('refuses the connection, naming the system, when the identity read is not a 200', async () => {
    const fakeAgentTab = createFakeAgentTab(() => ({ status: 401, body: 'Unauthorized' }));
    const { agentTransport } = createJiraTransport(fakeAgentTab);

    await expect(agentTransport.connect(JIRA_URL)).rejects.toThrow('Jira answered 401 when asked who is signed in');
    expect(agentTransport.isConnected()).toBe(false);
  });

  it('answers status 0 without sending anything when not connected', async () => {
    const fakeAgentTab = createFakeAgentTab(answerIdentity);
    const { agentTransport, onDisconnected } = createJiraTransport(fakeAgentTab);
    await expect(agentTransport.execute({ method: 'GET', path: '/x' })).resolves.toEqual({ status: 0, body: 'Jira is not connected' });
    expect(fakeAgentTab.receivedRequests).toHaveLength(0);
    expect(onDisconnected).not.toHaveBeenCalled();
  });

  it('reports a closed tab by name and drops the connection', async () => {
    const fakeAgentTab = createFakeAgentTab(answerIdentity);
    const { agentTransport, onDisconnected } = createJiraTransport(fakeAgentTab);
    await agentTransport.connect(JIRA_URL);

    fakeAgentTab.fakeTab.closed = true;

    await expect(agentTransport.execute({ method: 'GET', path: '/x' })).resolves.toEqual({ status: 0, body: 'The Jira tab was closed' });
    expect(onDisconnected).toHaveBeenCalledWith('The Jira tab was closed');
    expect(agentTransport.isConnected()).toBe(false);
  });

  it('drops the connection without a reason when the open tab stops answering', async () => {
    const fakeAgentTab = createFakeAgentTab((agentRequest) => (agentRequest.path === IDENTITY_PATH ? { status: 200, body: '{"displayName":"Smith, Jane"}' } : null));
    const { agentTransport, onDisconnected } = createJiraTransport(fakeAgentTab);
    await agentTransport.connect(JIRA_URL);

    await expect(agentTransport.execute({ method: 'GET', path: '/x' })).resolves.toEqual({ status: 0, body: 'timeout' });
    expect(onDisconnected).toHaveBeenCalledWith(undefined);
    expect(agentTransport.isConnected()).toBe(false);
  });

  it('gives a file transfer far longer than an ordinary request before giving up', async () => {
    const fakeAgentTab = createFakeAgentTab((agentRequest) => {
      if (agentRequest.path === IDENTITY_PATH) return { status: 200, body: '{"displayName":"Smith, Jane"}' };
      return { status: 200, body: 'UEsDBA==', delayMs: SLOW_ANSWER_DELAY_MS };
    });
    const { agentTransport, onDisconnected } = createJiraTransport(fakeAgentTab);
    await agentTransport.connect(JIRA_URL);

    const fileResponse = await agentTransport.execute({ method: 'GET', path: '/secure/attachment/1/a.zip', responseEncoding: 'base64' });
    expect(fileResponse.status).toBe(200);
    expect(onDisconnected).not.toHaveBeenCalled();

    const ordinaryResponse = await agentTransport.execute({ method: 'GET', path: '/rest/api/2/issue/A-1' });
    expect(ordinaryResponse).toEqual({ status: 0, body: 'timeout' });
  });
  it('says plainly when the browser blocks the tab from opening', async () => {
    const fakeAgentTab = createFakeAgentTab(answerIdentity);
    const { agentTransport } = createJiraTransport(fakeAgentTab, { openWindow: vi.fn(() => null) });
    await expect(agentTransport.connect(JIRA_URL)).rejects.toThrow('The browser blocked the Jira tab — allow pop-ups');
  });

  it('stops waiting within a second when the tab is closed or cut off, instead of waiting out the hello', async () => {
    const fakeAgentTab = createFakeAgentTab(answerIdentity);
    const openWindow = vi.fn(() => {
      // A tab the browser cuts off (pop-up isolation) reads as closed to the page that opened it.
      fakeAgentTab.fakeTab.closed = true;
      return fakeAgentTab.fakeTab as unknown as Window;
    });
    const { agentTransport } = createJiraTransport(fakeAgentTab, { openWindow, helloTimeoutMs: 60_000 });
    const startedAt = Date.now();
    await expect(agentTransport.connect(JIRA_URL)).rejects.toThrow('the browser cut its link to this page');
    expect(Date.now() - startedAt).toBeLessThan(TAB_CHECK_INTERVAL_MS * 3);
  });

  it('reuses its own open tab for the same address without reloading it, but opens a new address afresh', async () => {
    const fakeAgentTab = createFakeAgentTab(answerIdentity);
    const { agentTransport, openWindow } = createJiraTransport(fakeAgentTab);
    await agentTransport.connect(JIRA_URL);

    setTimeout(() => fakeAgentTab.sayHello(), 0);
    await agentTransport.connect(JIRA_URL);
    expect(openWindow).toHaveBeenCalledTimes(1);

    const movedJiraUrl = 'https://jira.example.com/new';
    await agentTransport.connect(movedJiraUrl);
    expect(openWindow).toHaveBeenLastCalledWith(movedJiraUrl, 'snowWizardJira');
  });

  it('gives a request the longer wait it asks for', async () => {
    const fakeAgentTab = createFakeAgentTab((agentRequest) => {
      if (agentRequest.path === IDENTITY_PATH) return { status: 200, body: '{"displayName":"Smith, Jane"}' };
      return { status: 201, body: '{}', delayMs: SLOW_ANSWER_DELAY_MS };
    });
    const { agentTransport } = createJiraTransport(fakeAgentTab);
    await agentTransport.connect(JIRA_URL);
    const slowResponse = await agentTransport.execute({ method: 'POST', path: '/rest/api/2/issue', timeoutMs: SLOW_ANSWER_DELAY_MS * 4 });
    expect(slowResponse.status).toBe(201);
  });
});
