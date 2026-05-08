// SettingsView.test.tsx — Unit tests for the application settings view.

import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchProxyConfigMock, fetchProxyStatusMock, updateProxyConfigMock } = vi.hoisted(() => ({
  fetchProxyConfigMock: vi.fn(),
  fetchProxyStatusMock: vi.fn(),
  updateProxyConfigMock: vi.fn(),
}));

vi.mock('@/services/proxyApi.ts', () => ({
  fetchProxyConfig: fetchProxyConfigMock,
  fetchProxyStatus: fetchProxyStatusMock,
  updateProxyConfig: updateProxyConfigMock,
}));

import SettingsView from './SettingsView.tsx';

const MOCK_PROXY_CONFIG = {
  jiraBaseUrl: 'https://jira.example.com',
  snowBaseUrl: 'https://snow.example.com',
  confluenceBaseUrl: 'https://confluence.example.com',
  adminPin: '1234',
};

const MOCK_PROXY_STATUS = {
  version: '1.2.3',
  sslVerify: true,
  jira: { configured: true, hasCredentials: true, ready: true, baseUrl: 'https://jira.example.com' },
  snow: { configured: true, hasCredentials: true, ready: true, sessionMode: false, sessionExpiresAt: null, baseUrl: 'https://snow.example.com' },
  github: { configured: false, hasCredentials: false, ready: false },
  confluence: { configured: true, hasCredentials: true, ready: true, baseUrl: 'https://confluence.example.com' },
};

describe('SettingsView', () => {
  beforeEach(() => {
    window.localStorage.clear();
    fetchProxyConfigMock.mockReset();
    fetchProxyStatusMock.mockReset();
    updateProxyConfigMock.mockReset();
    fetchProxyConfigMock.mockResolvedValue(MOCK_PROXY_CONFIG);
    fetchProxyStatusMock.mockResolvedValue(MOCK_PROXY_STATUS);
    updateProxyConfigMock.mockResolvedValue(undefined);
  });

  it('renders the expected section headings', async () => {
    render(<SettingsView />);

    await waitFor(() => {
      expect(fetchProxyConfigMock).toHaveBeenCalledTimes(1);
      expect(fetchProxyStatusMock).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByRole('heading', { name: 'Jira Connection' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'ServiceNow Connection' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Appearance' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Version' })).toBeInTheDocument();
  });

  it('populates inputs from the fetched proxy configuration', async () => {
    render(<SettingsView />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('https://jira.example.com')).toBeInTheDocument();
    });

    expect(screen.getByDisplayValue('https://snow.example.com')).toBeInTheDocument();
    expect(screen.getByDisplayValue('https://confluence.example.com')).toBeInTheDocument();
  });

  it('shows the theme toggle controls', async () => {
    render(<SettingsView />);

    await waitFor(() => {
      expect(fetchProxyConfigMock).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByRole('button', { name: 'Dark' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Light' })).toBeInTheDocument();
  });
});
