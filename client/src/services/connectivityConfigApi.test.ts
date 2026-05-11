// connectivityConfigApi.test.ts — Unit tests for the connectivity configuration API client.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchConnectivityConfig,
  saveConnectivityConfig,
  testSnowConnectivity,
  testGitHubConnectivity,
} from './connectivityConfigApi.ts';

const MOCK_CONNECTIVITY_RESULT = {
  snow: { baseUrl: 'https://acme.service-now.com', hasCredentials: true, usernameMasked: 'svc_****x' },
  github: { baseUrl: 'https://api.github.com', hasPat: true },
};

const MOCK_PROBE_OK: import('../types/config.ts').ConnectionProbeResult = {
  isOk: true,
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
  it('returns probe result', async () => {
    mockFetchOnce(MOCK_PROBE_OK);
    const result = await testSnowConnectivity();
    expect(result.isOk).toBe(true);
  });
});

describe('testGitHubConnectivity', () => {
  it('returns probe result', async () => {
    mockFetchOnce(MOCK_PROBE_OK);
    const result = await testGitHubConnectivity();
    expect(result.isOk).toBe(true);
  });
});
