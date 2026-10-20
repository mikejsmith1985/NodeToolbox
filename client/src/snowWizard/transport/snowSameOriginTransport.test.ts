// snowSameOriginTransport.test.ts — Proves the Wizard calls ServiceNow directly, like the relay bookmarklet did, and
// recovers from an expired session token once before asking the user to reconnect.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSnowSameOriginTransport, requestTokenOverChannel } from './snowSameOriginTransport.ts';

const INSTANCE_ORIGIN = 'https://acme.service-now.com';

function createTransport(fetchFn: (input: string, init?: RequestInit) => Promise<Response>, requestFreshToken = vi.fn(async () => null as string | null)) {
  const onSessionExpired = vi.fn();
  const transport = createSnowSameOriginTransport({
    instanceOrigin: INSTANCE_ORIGIN,
    initialToken: 'token-1',
    fetchFn,
    requestFreshToken,
    onSessionExpired,
  });
  return { transport, onSessionExpired, requestFreshToken };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createSnowSameOriginTransport', () => {
  it('sends a JSON request on ServiceNow\'s own origin with the session cookie and token, returning the raw text', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('{"result":{"number":"CHG1"}}', { status: 201 }));
    const { transport } = createTransport(fetchFn);

    const relayResult = await transport.execute({ sys: 'snow', id: 'r1', method: 'POST', path: '/api/now/table/change_request', body: { short_description: 'x' } });

    expect(relayResult).toEqual({ id: 'r1', ok: true, status: 201, data: '{"result":{"number":"CHG1"}}', error: null });
    const [requestUrl, requestInit] = fetchFn.mock.calls[0];
    expect(requestUrl).toBe(`${INSTANCE_ORIGIN}/api/now/table/change_request`);
    expect(requestInit).toEqual(expect.objectContaining({ method: 'POST', credentials: 'include', body: '{"short_description":"x"}' }));
    expect(requestInit.headers).toEqual(expect.objectContaining({ 'X-UserToken': 'token-1', 'Content-Type': 'application/json', Accept: 'application/json' }));
  });

  it('sends a base64 file body as raw bytes with the caller\'s content type', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
    const { transport } = createTransport(fetchFn);

    await transport.execute({ sys: 'snow', id: 'r2', method: 'POST', path: '/api/now/attachment/file', body: btoa('abc'), bodyEncoding: 'base64', contentType: 'application/zip' });

    const requestInit = fetchFn.mock.calls[0][1];
    expect(requestInit.headers['Content-Type']).toBe('application/zip');
    expect(Array.from(requestInit.body as Uint8Array)).toEqual([97, 98, 99]);
  });

  it('reports a network failure as status 0 with the browser\'s reason, never throwing', async () => {
    const { transport } = createTransport(vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(transport.execute({ sys: 'snow', id: 'r3', method: 'GET', path: '/api/now/table/x' }))
      .resolves.toEqual({ id: 'r3', ok: false, status: 0, data: null, error: 'Failed to fetch' });
  });

  it('on a 401 fetches a fresh token once and retries with it', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const { transport, onSessionExpired } = createTransport(fetchFn, vi.fn(async () => 'token-2'));

    const relayResult = await transport.execute({ sys: 'snow', id: 'r4', method: 'GET', path: '/api/now/table/x' });

    expect(relayResult.ok).toBe(true);
    expect(fetchFn.mock.calls[1][1].headers['X-UserToken']).toBe('token-2');
    expect(transport.readToken()).toBe('token-2');
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it('accepts a token pushed by the ServiceNow tab, ignoring an empty one', () => {
    const { transport } = createTransport(vi.fn());
    transport.updateToken('');
    expect(transport.readToken()).toBe('token-1');
    transport.updateToken('pushed');
    expect(transport.readToken()).toBe('pushed');
  });

  it('says the session expired when no fresh token can be had', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('', { status: 401 }));
    const { transport, onSessionExpired } = createTransport(fetchFn);

    const relayResult = await transport.execute({ sys: 'snow', id: 'r5', method: 'GET', path: '/api/now/table/x' });

    expect(relayResult.status).toBe(401);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(onSessionExpired).toHaveBeenCalled();
  });
});

describe('requestTokenOverChannel', () => {
  it('resolves the token the ServiceNow tab answers with', async () => {
    const listeners: Array<(messageEvent: MessageEvent) => void> = [];
    const fakeChannel = {
      postMessage: vi.fn(() => queueMicrotask(() => listeners.forEach((listener) => listener(new MessageEvent('message', { data: { kind: 'token', token: 'fresh' } }))))),
      addEventListener: (_type: 'message', listener: (messageEvent: MessageEvent) => void) => listeners.push(listener),
      close: vi.fn(),
    };
    await expect(requestTokenOverChannel(() => fakeChannel, 'snowWizard', 1000)).resolves.toBe('fresh');
    expect(fakeChannel.close).toHaveBeenCalled();
  });

  it('resolves null when nobody answers in time', async () => {
    vi.useFakeTimers();
    const tokenPromise = requestTokenOverChannel(() => ({ postMessage: vi.fn(), addEventListener: vi.fn(), close: vi.fn() }), 'snowWizard', 1000);
    vi.advanceTimersByTime(1001);
    await expect(tokenPromise).resolves.toBeNull();
  });
});
