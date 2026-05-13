// connectivityConfigApi.test.ts — Unit tests for the connectivity configuration API client.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchConnectivityConfig,
  saveConnectivityConfig,
  testSnowConnectivity,
  testGitHubConnectivity,
  testConfluenceConnectivity,
} from './connectivityConfigApi.ts';

const MOCK_CONNECTIVITY_RESULT = {
  snow:       { baseUrl: 'https://acme.service-now.com', hasCredentials: true, usernameMasked: 'svc_****x' },
  github:     { baseUrl: 'https://api.github.com', hasPat: true },
  confluence: { baseUrl: 'https://acme.atlassian.net', hasCredentials: true, usernameMasked: 'yo****m' },
};

// The server returns `ok` (not `isOk`). The API layer maps ok → isOk.
// This mock intentionally mirrors the real server's JSON shape, not the TypeScript interface.
const MOCK_SERVER_PROBE_OK = {
  ok: true,
  statusCode: 200,
  message: 'Connected successfully.',
};

/** Registers a one-shot fetch mock that returns the given body with the specified status. */
function mockFetchOnce(body: unknown, ok = true, status = 200): void {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('fetchConnectivityConfig', () => {
  it('returns parsed connectivity config on success', async () => {
    mockFetchOnce(MOCK_CONNECTIVITY_RESULT);
    const result = await fetchConnectivityConfig();
    expect(result.snow.baseUrl).toBe('https://acme.service-now.com');
    expect(result.github.hasPat).toBe(true);
    expect(result.confluence.hasCredentials).toBe(true);
  });

  it('throws when server returns non-ok response', async () => {
    mockFetchOnce({}, false, 500);
    await expect(fetchConnectivityConfig()).rejects.toThrow('HTTP 500');
  });
});

describe('saveConnectivityConfig', () => {
  it('posts the update and returns the saved config', async () => {
    mockFetchOnce(MOCK_CONNECTIVITY_RESULT);
    const result = await saveConnectivityConfig({ snow: { baseUrl: 'https://acme.service-now.com' } });
    expect(result.snow.baseUrl).toBe('https://acme.service-now.com');
  });

  it('throws when server returns non-ok response', async () => {
    mockFetchOnce({}, false, 500);
    await expect(saveConnectivityConfig({})).rejects.toThrow('HTTP 500');
  });
});

describe('testSnowConnectivity', () => {
  it('returns probe result with isOk mapped from server ok field', async () => {
    mockFetchOnce(MOCK_SERVER_PROBE_OK);
    const result = await testSnowConnectivity();
    expect(result.isOk).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.message).toBe('Connected successfully.');
  });

  it('maps server ok=false to isOk=false', async () => {
    mockFetchOnce({ ok: false, statusCode: 401, message: 'Unauthorized.' });
    const result = await testSnowConnectivity();
    expect(result.isOk).toBe(false);
    expect(result.statusCode).toBe(401);
  });
});

describe('testGitHubConnectivity', () => {
  it('returns probe result with isOk mapped from server ok field', async () => {
    mockFetchOnce(MOCK_SERVER_PROBE_OK);
    const result = await testGitHubConnectivity();
    expect(result.isOk).toBe(true);
    expect(result.statusCode).toBe(200);
  });
});

describe('testConfluenceConnectivity', () => {
  it('returns probe result with isOk mapped from server ok field', async () => {
    mockFetchOnce(MOCK_SERVER_PROBE_OK);
    const result = await testConfluenceConnectivity();
    expect(result.isOk).toBe(true);
    expect(result.statusCode).toBe(200);
  });

  it('maps server ok=false to isOk=false (e.g. 403 wrong credentials)', async () => {
    mockFetchOnce({ ok: false, statusCode: 403, message: 'Check your Atlassian Cloud API token.' });
    const result = await testConfluenceConnectivity();
    expect(result.isOk).toBe(false);
    expect(result.statusCode).toBe(403);
  });

  it('posts system=confluence to the test endpoint', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true, status: 200, json: () => Promise.resolve(MOCK_SERVER_PROBE_OK),
    } as Response);
    await testConfluenceConnectivity();
    const requestBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(requestBody.system).toBe('confluence');
  });
});
