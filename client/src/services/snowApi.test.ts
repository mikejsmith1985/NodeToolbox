// snowApi.test.ts — Unit tests for the ServiceNow proxy/relay client.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useConnectionStore } from '../store/connectionStore.ts';
import { snowFetch, snowUploadFile } from './snowApi.ts';

vi.mock('./relayBridgeApi.ts', () => ({
  postRelayRequest: vi.fn(),
  waitForRelayResult: vi.fn(),
}));

import { postRelayRequest, waitForRelayResult } from './relayBridgeApi.ts';

const SNOW_PATH = '/api/now/table/change_request';
const SNOW_RESPONSE = { result: [] };

function resetConnectionStore(): void {
  useConnectionStore.setState(useConnectionStore.getInitialState());
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid-relay-001' });
  resetConnectionStore();
});

afterEach(() => {
  // clearAllMocks clears call history on module mock vi.fn() instances (which
  // restoreAllMocks skips because they aren't spies). This prevents call counts
  // from one test leaking into the next.
  vi.clearAllMocks();
});

// ── Relay-required path (relay inactive) ─────────────────────────────────────

describe('snowApi — relay inactive', () => {
  it('does not silently fall back to the server-side proxy', async () => {
    await expect(snowFetch<typeof SNOW_RESPONSE>(SNOW_PATH)).rejects.toThrow(
      'SNow relay not connected',
    );

    expect(fetch).not.toHaveBeenCalled();
    expect(postRelayRequest).not.toHaveBeenCalled();
  });
});

// ── Relay routing path (relay active) ────────────────────────────────────────

describe('snowApi — relay routing (relay active)', () => {
  beforeEach(() => {
    // Activate relay bridge so snowFetch routes through it
    useConnectionStore.setState({
      relayBridgeStatus: {
        system: 'snow',
        isConnected: true,
        lastPingAt: null,
        version: null,
        hasSessionToken: true,
      },
    });
  });

  it('routes through the relay bridge when relay is active', async () => {
    vi.mocked(postRelayRequest).mockResolvedValue(undefined);
    vi.mocked(waitForRelayResult).mockResolvedValue({
      id: 'test-uuid-relay-001',
      ok: true,
      status: 200,
      data: SNOW_RESPONSE,
      error: null,
    });

    const result = await snowFetch<typeof SNOW_RESPONSE>(SNOW_PATH);

    expect(postRelayRequest).toHaveBeenCalledWith({
      sys: 'snow',
      id: 'test-uuid-relay-001',
      method: 'GET',
      path: SNOW_PATH,
      body: null,
      authHeader: null,
    });
    expect(waitForRelayResult).toHaveBeenCalledWith('test-uuid-relay-001', 'snow');
    // fetch (/snow-proxy) must NOT be called — relay path bypasses it
    expect(fetch).not.toHaveBeenCalled();
    expect(result).toEqual(SNOW_RESPONSE);
  });

  it('falls back to direct proxy when forceDirectProxy is true', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(SNOW_RESPONSE),
    } as unknown as Response);

    await snowFetch(SNOW_PATH, { forceDirectProxy: true });

    expect(fetch).toHaveBeenCalledWith(`/snow-proxy${SNOW_PATH}`, {});
    expect(postRelayRequest).not.toHaveBeenCalled();
  });

  it('throws with a relay-specific message when the relay returns a non-ok result', async () => {
    vi.mocked(postRelayRequest).mockResolvedValue(undefined);
    vi.mocked(waitForRelayResult).mockResolvedValue({
      id: 'test-uuid-relay-001',
      ok: false,
      status: 403,
      data: null,
      error: 'Forbidden',
    });

    await expect(snowFetch(SNOW_PATH)).rejects.toThrow(
      'SNow relay fetch /api/now/table/change_request failed: 403 — Forbidden (ServiceNow rejected the relayed request — this can be a session/permission problem or a data-policy rejection; check the ServiceNow message if shown, otherwise refresh the SNow tab and re-click the bookmarklet.)',
    );
  });

  it("surfaces ServiceNow's own error message and detail from a failed response body (GH #282)", async () => {
    vi.mocked(postRelayRequest).mockResolvedValue(undefined);
    vi.mocked(waitForRelayResult).mockResolvedValue({
      id: 'test-uuid-relay-002',
      ok: false,
      status: 403,
      // The bookmarklet always posts the response body text, even for failed requests —
      // ServiceNow puts the human-readable reason there (e.g. a data-policy rejection).
      data: JSON.stringify({
        error: { message: 'Operation Failed', detail: 'Data Policy Exception: End date must be after start date' },
        status: 'failure',
      }),
      error: null,
    });

    await expect(snowFetch(SNOW_PATH)).rejects.toThrow(
      /ServiceNow says: Operation Failed · Data Policy Exception: End date must be after start date/,
    );
  });

  it('throws a timeout error when the relay bridge does not respond in time', async () => {
    vi.mocked(postRelayRequest).mockResolvedValue(undefined);
    vi.mocked(waitForRelayResult).mockRejectedValue(
      new Error('Relay bridge timed out (30 seconds). Is the bookmarklet still active on the ServiceNow page?'),
    );

    await expect(snowFetch(SNOW_PATH)).rejects.toThrow('Relay bridge timed out');
  });
});

describe('snowApi — relay active before token readiness', () => {
  beforeEach(() => {
    useConnectionStore.setState({
      relayBridgeStatus: {
        system: 'snow',
        isConnected: true,
        lastPingAt: null,
        version: null,
        hasSessionToken: false,
      },
    });
  });

  it('allows GET requests while the relay waits for the g_ck token', async () => {
    vi.mocked(postRelayRequest).mockResolvedValue(undefined);
    vi.mocked(waitForRelayResult).mockResolvedValue({
      id: 'test-uuid-relay-001',
      ok: true,
      status: 200,
      data: SNOW_RESPONSE,
      error: null,
    });

    await expect(snowFetch<typeof SNOW_RESPONSE>(SNOW_PATH)).resolves.toEqual(SNOW_RESPONSE);
    expect(postRelayRequest).toHaveBeenCalledWith(expect.objectContaining({ method: 'GET' }));
  });

  it('blocks write requests until the relay reports g_ck token readiness', async () => {
    await expect(
      snowFetch(SNOW_PATH, { method: 'POST', body: JSON.stringify({ short_description: 'Test CHG' }) }),
    ).rejects.toThrow('SNow session token (g_ck) not ready');

    expect(postRelayRequest).not.toHaveBeenCalled();
  });
});

// ── File upload through the relay ────────────────────────────────────────────

describe('snowApi — snowUploadFile', () => {
  const UPLOAD_PATH = '/api/now/attachment/file?table_name=change_request&table_sys_id=abc&file_name=evidence.zip';
  const FILE_BYTES = new Uint8Array([80, 75, 3, 4]);

  function activateRelay(hasSessionToken: boolean): void {
    useConnectionStore.setState({
      relayBridgeStatus: { system: 'snow', isConnected: true, lastPingAt: null, version: null, hasSessionToken },
    });
  }

  it('refuses when the relay is not connected — the server proxy has no Okta session to fall back to', async () => {
    await expect(snowUploadFile(UPLOAD_PATH, FILE_BYTES, 'application/zip')).rejects.toThrow('SNow relay not connected');
    expect(postRelayRequest).not.toHaveBeenCalled();
  });

  it('refuses before g_ck is ready, because an upload is a write', async () => {
    activateRelay(false);

    await expect(snowUploadFile(UPLOAD_PATH, FILE_BYTES, 'application/zip')).rejects.toThrow('g_ck');
    expect(postRelayRequest).not.toHaveBeenCalled();
  });

  it('carries the bytes as base64 with the content type and a longer wait', async () => {
    activateRelay(true);
    vi.mocked(waitForRelayResult).mockResolvedValue({ id: 'test-uuid-relay-001', ok: true, status: 201, data: '{"result":{"sys_id":"att1"}}', error: null });

    const uploadResult = await snowUploadFile<{ result: { sys_id: string } }>(UPLOAD_PATH, FILE_BYTES, 'application/zip');

    expect(postRelayRequest).toHaveBeenCalledWith({
      sys: 'snow',
      id: 'test-uuid-relay-001',
      method: 'POST',
      path: UPLOAD_PATH,
      body: btoa(String.fromCharCode(80, 75, 3, 4)),
      bodyEncoding: 'base64',
      contentType: 'application/zip',
      timeoutMs: 180_000,
      authHeader: null,
    });
    expect(waitForRelayResult).toHaveBeenCalledWith('test-uuid-relay-001', 'snow', 180_000);
    expect(uploadResult.result.sys_id).toBe('att1');
  });

  it("explains a refused upload with ServiceNow's own words", async () => {
    activateRelay(true);
    vi.mocked(waitForRelayResult).mockResolvedValue({
      id: 'test-uuid-relay-001', ok: false, status: 413,
      data: '{"error":{"message":"Attachment too large","detail":"limit 50MB"}}', error: null,
    });

    await expect(snowUploadFile(UPLOAD_PATH, FILE_BYTES, 'application/zip'))
      .rejects.toThrow('413 — ServiceNow says: Attachment too large · limit 50MB');
  });
});
