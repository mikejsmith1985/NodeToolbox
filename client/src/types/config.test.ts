// config.test.ts — Runtime shape checks for shared proxy configuration type literals.

import { describe, expect, it } from 'vitest';

import type {
  CredentialState,
  ProxyConfig,
  ProxyStatusResponse,
  Theme,
} from './config.ts';

describe('config types', () => {
  it('accepts a proxy config literal with the expected keys', () => {
    const proxyConfig: ProxyConfig = {
      jiraBaseUrl: 'https://jira.example.com',
      snowBaseUrl: 'https://snow.example.com',
      confluenceBaseUrl: 'https://confluence.example.com',
      adminPin: '1234',
    };

    expect(proxyConfig).toHaveProperty('jiraBaseUrl');
    expect(proxyConfig).toHaveProperty('snowBaseUrl');
    expect(proxyConfig).toHaveProperty('confluenceBaseUrl');
    expect(proxyConfig).toHaveProperty('adminPin');
  });

  it('accepts credential state flags with the expected keys', () => {
    const credentialState: CredentialState = {
      isJiraConfigured: true,
      isSnowConfigured: false,
      isConfluenceConfigured: true,
    };

    expect(credentialState).toHaveProperty('isJiraConfigured');
    expect(credentialState).toHaveProperty('isSnowConfigured');
    expect(credentialState).toHaveProperty('isConfluenceConfigured');
  });

  it('accepts a proxy-status response literal with the expected keys', () => {
    const proxyStatusResponse: ProxyStatusResponse = {
      version: '1.2.3',
      jiraConfigured: true,
      snowConfigured: true,
      confluenceConfigured: false,
      schedulerEnabled: true,
    };

    expect(proxyStatusResponse).toHaveProperty('version');
    expect(proxyStatusResponse).toHaveProperty('jiraConfigured');
    expect(proxyStatusResponse).toHaveProperty('snowConfigured');
    expect(proxyStatusResponse).toHaveProperty('confluenceConfigured');
    expect(proxyStatusResponse).toHaveProperty('schedulerEnabled');
  });

  it('accepts supported theme literals', () => {
    const theme: Theme = 'dark';

    expect(theme).toBe('dark');
  });
});
