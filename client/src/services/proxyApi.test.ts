// proxyApi.test.ts — Unit tests for the typed Express proxy API client.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConnectionProbeResult, ProxyConfig, ProxyStatusResponse } from '../types/config.ts';
import {
  fetchProxyConfig,
  fetchProxyStatus,
  probeJiraConnection,
  probeSnowConnection,
  updateProxyConfig,
} from './proxyApi.ts';

const MOCK_PROXY_STATUS: ProxyStatusResponse = {
  version: '1.0.0',
  jiraConfigured: true,
  snowConfigured: false,
  confluenceConfigured: true,
  schedulerEnabled: true,
};

const MOCK_PROXY_CONFIG: ProxyConfig = {
  jiraBaseUrl: 'https://jira.example.com',
  snowBaseUrl: 'https://snow.example.com',
  confluenceBaseUrl: 'https://confluence.example.com',
  adminPin: '2468',
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

describe('proxyApi', () => {
  it('fetchProxyStatus calls the status endpoint and returns parsed JSON', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(MOCK_PROXY_STATUS),
    } as unknown as Response);

    await expect(fetchProxyStatus()).resolves.toEqual(MOCK_PROXY_STATUS);
    expect(fetch).toHaveBeenCalledWith('/api/proxy-status');
  });

  it('fetchProxyStatus throws on a non-ok response', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500 } as Response);

    await expect(fetchProxyStatus()).rejects.toThrow('proxy-status fetch failed: 500');
  });

  it('fetchProxyConfig calls the config endpoint and returns parsed JSON', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(MOCK_PROXY_CONFIG),
    } as unknown as Response);

    await expect(fetchProxyConfig()).resolves.toEqual(MOCK_PROXY_CONFIG);
    expect(fetch).toHaveBeenCalledWith('/api/proxy-config');
  });

  it('fetchProxyConfig throws on a non-ok response', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 404 } as Response);

    await expect(fetchProxyConfig()).rejects.toThrow('proxy-config fetch failed: 404');
  });

  it('updateProxyConfig posts JSON to the config endpoint', async () => {
    const partialConfig: Partial<ProxyConfig> = { jiraBaseUrl: 'https://jira.changed.example.com' };

    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200 } as Response);

    await expect(updateProxyConfig(partialConfig)).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith('/api/proxy-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(partialConfig),
    });
  });

  it('updateProxyConfig throws on a non-ok response', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 400 } as Response);

    await expect(updateProxyConfig({ adminPin: '1357' })).rejects.toThrow(
      'proxy-config update failed: 400',
    );
  });

  describe('probeJiraConnection', () => {
    it('returns ok=true when the Jira myself endpoint responds 200', async () => {
      vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200 } as Response);

      const probeResult: ConnectionProbeResult = await probeJiraConnection();

      expect(probeResult.isOk).toBe(true);
      expect(probeResult.statusCode).toBe(200);
      expect(fetch).toHaveBeenCalledWith('/jira-proxy/rest/api/2/myself');
    });

    it('returns ok=false with the status code when Jira returns 401', async () => {
      vi.mocked(fetch).mockResolvedValue({ ok: false, status: 401 } as Response);

      const probeResult: ConnectionProbeResult = await probeJiraConnection();

      expect(probeResult.isOk).toBe(false);
      expect(probeResult.statusCode).toBe(401);
      expect(probeResult.message).toContain('401');
    });

    it('returns ok=false with statusCode 0 when the fetch throws a network error', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('Network failure'));

      const probeResult: ConnectionProbeResult = await probeJiraConnection();

      expect(probeResult.isOk).toBe(false);
      expect(probeResult.statusCode).toBe(0);
    });
  });

  describe('probeSnowConnection', () => {
    it('returns ok=true when the SNow probe endpoint responds 200', async () => {
      vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200 } as Response);

      const probeResult: ConnectionProbeResult = await probeSnowConnection();

      expect(probeResult.isOk).toBe(true);
      expect(probeResult.statusCode).toBe(200);
      expect(fetch).toHaveBeenCalledWith('/snow-proxy/api/now/table/sys_user?sysparm_limit=1');
    });

    it('returns ok=false with statusCode 0 on network error', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('Network failure'));

      const probeResult: ConnectionProbeResult = await probeSnowConnection();

      expect(probeResult.isOk).toBe(false);
      expect(probeResult.statusCode).toBe(0);
    });
  });
});
