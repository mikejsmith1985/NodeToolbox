// proxyApi.test.ts — Unit tests for the typed Express proxy API client.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProxyConfig, ProxyStatusResponse } from '../types/config.ts';
import {
  fetchProxyConfig,
  fetchProxyStatus,
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
});
