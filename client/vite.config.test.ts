// vite.config.test.ts — Validates that the Vite configuration is correctly wired
// to proxy all backend routes to the Express server at port 5555.
//
// This prevents accidental misconfiguration where a missing proxy rule causes
// React dev server to return 404s instead of forwarding to the real backend.

import { describe, it, expect } from 'vitest';
import config from './vite.config';

// The proxy map is typed loosely by Vite — cast to read entries cleanly
type ProxyConfig = Record<string, { target: string; changeOrigin: boolean }>;

describe('vite.config — proxy configuration', () => {
  it('proxies /api/* to the Express backend at port 5555', () => {
    const proxyRules = config.server?.proxy as ProxyConfig;
    expect(proxyRules['/api'].target).toContain('5555');
  });

  it('proxies /jira-proxy to the Express backend', () => {
    const proxyRules = config.server?.proxy as ProxyConfig;
    expect(proxyRules['/jira-proxy'].target).toContain('5555');
  });

  it('proxies /snow-proxy to the Express backend', () => {
    const proxyRules = config.server?.proxy as ProxyConfig;
    expect(proxyRules['/snow-proxy'].target).toContain('5555');
  });

  it('proxies /github-proxy to the Express backend', () => {
    const proxyRules = config.server?.proxy as ProxyConfig;
    expect(proxyRules['/github-proxy'].target).toContain('5555');
  });

  it('uses jsdom as the Vitest test environment so DOM APIs are available', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((config as any).test?.environment).toBe('jsdom');
  });
});
