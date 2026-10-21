// agentChannel.test.ts — Proves the Wizard side of the tab-to-tab conversation: wait for the agent, ask, get the answer.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { AGENT_CLOSED_CHECK_INTERVAL_MS, AGENT_TAB_CLOSED_BODY, sendAgentRequest, waitForAgentHello } from './agentChannel.ts';

const CHANNEL_NAME = 'snowWizardProbe';

function postFromAgent(data: unknown, source: MessageEventSource | null = null, origin = 'https://jira.example.com'): void {
  window.dispatchEvent(new MessageEvent('message', { data, origin, source }));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('waitForAgentHello', () => {
  it('resolves with the agent window and origin once the agent says hello on our channel', async () => {
    const agentWindow = { postMessage: vi.fn() } as unknown as MessageEventSource;
    const helloPromise = waitForAgentHello(window, CHANNEL_NAME, 1000);

    postFromAgent({ channel: 'someoneElse', kind: 'hello' }, agentWindow);
    postFromAgent({ channel: CHANNEL_NAME, kind: 'hello', system: 'jira' }, agentWindow);

    await expect(helloPromise).resolves.toEqual({ agentSource: agentWindow, agentOrigin: 'https://jira.example.com' });
  });

  it('ignores a hello from the other system when one system is expected', async () => {
    vi.useFakeTimers();
    const agentWindow = { postMessage: vi.fn() } as unknown as MessageEventSource;
    const helloPromise = waitForAgentHello(window, CHANNEL_NAME, 1000, 'jira');
    postFromAgent({ channel: CHANNEL_NAME, kind: 'hello', system: 'snow' }, agentWindow);
    vi.advanceTimersByTime(1001);
    await expect(helloPromise).rejects.toThrow('no hello');
  });

  it('ignores a hello from an unexpected origin when one origin is expected', async () => {
    vi.useFakeTimers();
    const agentWindow = { postMessage: vi.fn() } as unknown as MessageEventSource;
    const helloPromise = waitForAgentHello(window, CHANNEL_NAME, 1000, 'jira', 'https://jira.example.com');
    postFromAgent({ channel: CHANNEL_NAME, kind: 'hello', system: 'jira' }, agentWindow, 'https://other.example.com');
    vi.advanceTimersByTime(1001);
    await expect(helloPromise).rejects.toThrow('no hello');
  });

  it('rejects with a plain reason when no hello arrives in time', async () => {
    vi.useFakeTimers();
    const helloPromise = waitForAgentHello(window, CHANNEL_NAME, 1000);
    vi.advanceTimersByTime(1001);
    await expect(helloPromise).rejects.toThrow('no hello within 1s');
  });
});

describe('sendAgentRequest', () => {
  it('posts the request to the agent and resolves with the matching response only', async () => {
    const agentPostMessage = vi.fn();
    const agentSource = { postMessage: agentPostMessage } as unknown as MessageEventSource;

    const responsePromise = sendAgentRequest(window, agentSource, 'https://jira.example.com', CHANNEL_NAME, { method: 'GET', path: '/rest/api/2/myself' }, 1000);
    const sentRequest = agentPostMessage.mock.calls[0][0] as { requestId: string };

    expect(agentPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channel: CHANNEL_NAME, kind: 'request', method: 'GET', path: '/rest/api/2/myself' }),
      'https://jira.example.com',
    );
    postFromAgent({ channel: CHANNEL_NAME, kind: 'response', requestId: 'not-mine', status: 500, body: 'x' });
    postFromAgent({ channel: CHANNEL_NAME, kind: 'response', requestId: sentRequest.requestId, status: 200, body: 'ok' }, null, 'https://impostor.example.com');
    postFromAgent({ channel: CHANNEL_NAME, kind: 'response', requestId: sentRequest.requestId, status: 200, body: 'ok' });

    await expect(responsePromise).resolves.toEqual({ status: 200, body: 'ok' });
  });

  it('resolves status 0 "timeout" rather than hanging when the agent never answers', async () => {
    vi.useFakeTimers();
    const agentSource = { postMessage: vi.fn() } as unknown as MessageEventSource;
    const responsePromise = sendAgentRequest(window, agentSource, 'null', CHANNEL_NAME, { method: 'GET', path: '/rest/x' }, 500);
    vi.advanceTimersByTime(501);
    await expect(responsePromise).resolves.toEqual({ status: 0, body: 'timeout' });
  });

  it('answers at once, without posting, when the agent tab is already closed', async () => {
    const agentPostMessage = vi.fn();
    const agentSource = { postMessage: agentPostMessage, closed: true } as unknown as MessageEventSource;
    await expect(sendAgentRequest(window, agentSource, 'null', CHANNEL_NAME, { method: 'GET', path: '/rest/x' }, 30000))
      .resolves.toEqual({ status: 0, body: AGENT_TAB_CLOSED_BODY });
    expect(agentPostMessage).not.toHaveBeenCalled();
  });

  it('gives up within half a second when the agent tab is closed mid-request, not after the full wait', async () => {
    vi.useFakeTimers();
    const agentSource = { postMessage: vi.fn(), closed: false };
    const responsePromise = sendAgentRequest(window, agentSource as unknown as MessageEventSource, 'null', CHANNEL_NAME, { method: 'GET', path: '/rest/x' }, 30000);
    agentSource.closed = true;
    vi.advanceTimersByTime(AGENT_CLOSED_CHECK_INTERVAL_MS);
    await expect(responsePromise).resolves.toEqual({ status: 0, body: AGENT_TAB_CLOSED_BODY });
  });

  it('addresses a file:// agent (origin "null") with "*" because "null" is not a valid target origin', () => {
    const agentPostMessage = vi.fn();
    void sendAgentRequest(window, { postMessage: agentPostMessage } as unknown as MessageEventSource, 'null', CHANNEL_NAME, { method: 'GET', path: '/rest/x' }, 10);
    expect(agentPostMessage.mock.calls[0][1]).toBe('*');
  });

  it('asks for a file as base64 and hands back the note from the agent that the body is base64', async () => {
    const agentPostMessage = vi.fn();
    const agentSource = { postMessage: agentPostMessage } as unknown as MessageEventSource;
    const responsePromise = sendAgentRequest(window, agentSource, 'https://jira.example.com', CHANNEL_NAME,
      { method: 'GET', path: '/secure/attachment/1/a.pdf', responseEncoding: 'base64' }, 1000);
    const sentRequest = agentPostMessage.mock.calls[0][0] as { requestId: string; responseEncoding: string };
    expect(sentRequest.responseEncoding).toBe('base64');

    postFromAgent({ channel: CHANNEL_NAME, kind: 'response', requestId: sentRequest.requestId, status: 200, body: 'AQI=', bodyEncoding: 'base64' });

    await expect(responsePromise).resolves.toEqual({ status: 200, body: 'AQI=', bodyEncoding: 'base64' });
  });
});
