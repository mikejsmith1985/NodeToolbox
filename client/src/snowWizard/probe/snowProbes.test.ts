// snowProbes.test.ts — Proves each in-ServiceNow probe reports pass only on real evidence and names the failure otherwise.

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  SNOW_IDENTITY_PATH,
  pickAndRememberFile,
  readRememberedFile,
  runSnowBroadcastProbe,
  runSnowIdentityProbe,
  runSnowReadProbe,
  type FileHandleStore,
} from './snowProbes.ts';

const INSTANCE_ORIGIN = 'https://acme.service-now.com';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('runSnowIdentityProbe', () => {
  it('passes with the signed-in name when ServiceNow answers a same-origin call with the session token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ result: [{ name: 'Jane Smith' }] }));

    const outcome = await runSnowIdentityProbe(fetchMock, INSTANCE_ORIGIN, 'token-1');

    expect(outcome).toEqual({ isPassed: true, detail: 'signed in as Jane Smith' });
    expect(fetchMock).toHaveBeenCalledWith(`${INSTANCE_ORIGIN}${SNOW_IDENTITY_PATH}`, expect.objectContaining({
      credentials: 'include',
      headers: expect.objectContaining({ 'X-UserToken': 'token-1', Accept: 'application/json' }),
    }));
  });

  it('fails with the HTTP status when ServiceNow refuses', async () => {
    const outcome = await runSnowIdentityProbe(vi.fn().mockResolvedValue(jsonResponse({}, 401)), INSTANCE_ORIGIN, 'token-1');
    expect(outcome).toEqual({ isPassed: false, detail: 'HTTP 401' });
  });

  it('fails with the browser error text when the call cannot be made at all', async () => {
    const outcome = await runSnowIdentityProbe(vi.fn().mockRejectedValue(new TypeError('Failed to fetch')), INSTANCE_ORIGIN, '');
    expect(outcome).toEqual({ isPassed: false, detail: 'Failed to fetch' });
  });

  it('fails when the answer carries no user, rather than passing on an empty 200', async () => {
    const outcome = await runSnowIdentityProbe(vi.fn().mockResolvedValue(jsonResponse({ result: [] })), INSTANCE_ORIGIN, 't');
    expect(outcome).toEqual({ isPassed: false, detail: 'HTTP 200 but no user returned' });
  });
});

describe('runSnowReadProbe', () => {
  it('passes on a 200 from the change table and never sends anything but GET', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ result: [{ number: 'CHG0001' }] }));
    const outcome = await runSnowReadProbe(fetchMock, INSTANCE_ORIGIN, 't');
    expect(outcome.isPassed).toBe(true);
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ method: 'GET' }));
  });
});

describe('runSnowBroadcastProbe', () => {
  function createFakeChannelPair(answerToken: string | null) {
    const listeners: Array<(event: MessageEvent) => void> = [];
    return {
      postMessage: vi.fn((message: { kind: string }) => {
        if (message.kind === 'tokenRequest' && answerToken !== null) {
          queueMicrotask(() => listeners.forEach((listener) => listener(new MessageEvent('message', { data: { kind: 'token', token: answerToken } }))));
        }
      }),
      addEventListener: (_type: 'message', listener: (event: MessageEvent) => void) => listeners.push(listener),
      close: vi.fn(),
    };
  }

  it('passes when the ServiceNow tab answers with the same token', async () => {
    const fakeChannel = createFakeChannelPair('token-1');
    const outcome = await runSnowBroadcastProbe(() => fakeChannel, 'snowWizardProbe', 'token-1', 1000);
    expect(outcome).toEqual({ isPassed: true, detail: 'token received from the ServiceNow tab' });
    expect(fakeChannel.close).toHaveBeenCalled();
  });

  it('fails when no answer arrives in time', async () => {
    vi.useFakeTimers();
    const outcomePromise = runSnowBroadcastProbe(() => createFakeChannelPair(null), 'snowWizardProbe', 'token-1', 1000);
    vi.advanceTimersByTime(1001);
    await expect(outcomePromise).resolves.toEqual({ isPassed: false, detail: 'no answer within 1s' });
  });

  it('fails when the answer is an empty token', async () => {
    const outcome = await runSnowBroadcastProbe(() => createFakeChannelPair(''), 'snowWizardProbe', 'token-1', 1000);
    expect(outcome).toEqual({ isPassed: false, detail: 'answer carried no token' });
  });
});

describe('file handle probes', () => {
  function createMemoryStore(): FileHandleStore {
    let rememberedHandle: unknown = null;
    return {
      save: async (fileHandle) => { rememberedHandle = fileHandle; },
      load: async () => rememberedHandle as never,
    };
  }

  function createFakeHandle(fileName: string, permissionState: PermissionState = 'granted') {
    return {
      getFile: async () => new File(['abc'], fileName),
      queryPermission: async () => permissionState,
      requestPermission: async () => permissionState,
    };
  }

  it('fails plainly when the browser has no file picker', async () => {
    const outcome = await pickAndRememberFile(undefined, createMemoryStore());
    expect(outcome).toEqual({ isPassed: false, detail: 'this browser has no file picker (showOpenFilePicker)' });
  });

  it('remembers the picked file and reads it back from memory', async () => {
    const store = createMemoryStore();
    const pickerMock = vi.fn().mockResolvedValue([createFakeHandle('snow-hub-wizard.html')]);

    await expect(pickAndRememberFile(pickerMock, store)).resolves.toEqual({ isPassed: true, detail: 'picked snow-hub-wizard.html (3 bytes)' });
    await expect(readRememberedFile(store)).resolves.toEqual({ isPassed: true, detail: 'read snow-hub-wizard.html again from memory' });
  });

  it('reports a missing memory and a denied permission as failures', async () => {
    await expect(readRememberedFile(createMemoryStore())).resolves.toEqual({ isPassed: false, detail: 'nothing remembered yet — pick a file first' });

    const store = createMemoryStore();
    await store.save(createFakeHandle('x.html', 'denied') as never);
    await expect(readRememberedFile(store)).resolves.toEqual({ isPassed: false, detail: 'permission denied' });
  });
});
