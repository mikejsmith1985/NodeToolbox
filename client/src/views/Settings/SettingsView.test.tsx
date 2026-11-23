// SettingsView.test.tsx — Unit tests for the application settings view.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchProxyConfigMock, fetchProxyStatusMock, updateProxyConfigMock } = vi.hoisted(() => ({
  // Named for the helpers they stand in for: fetchServiceBaseUrls / saveServiceBaseUrl.
  fetchProxyConfigMock: vi.fn(),
  fetchProxyStatusMock: vi.fn(),
  updateProxyConfigMock: vi.fn(),
}));

vi.mock('@/services/proxyApi.ts', () => ({
  fetchServiceBaseUrls: fetchProxyConfigMock,
  fetchProxyStatus: fetchProxyStatusMock,
  saveServiceBaseUrl: updateProxyConfigMock,
}));

import SettingsView from './SettingsView.tsx';

const MOCK_PROXY_CONFIG = {
  jira: 'https://jira.example.com',
  snow: 'https://snow.example.com',
  confluence: 'https://confluence.example.com',
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

  it('saves an edited Jira URL to the server in the shape it merges (it used to be silently ignored)', async () => {
    render(<SettingsView />);
    const jiraInput = await screen.findByDisplayValue('https://jira.example.com');

    fireEvent.change(jiraInput, { target: { value: 'https://jira.new.example.com' } });
    fireEvent.blur(jiraInput);

    await waitFor(() => {
      expect(updateProxyConfigMock).toHaveBeenCalledWith('jira', 'https://jira.new.example.com');
    });
  });

  it('shows the theme toggle controls', async () => {
    render(<SettingsView />);

    await waitFor(() => {
      expect(fetchProxyConfigMock).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByRole('button', { name: 'Dark' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Light' })).toBeInTheDocument();
  });

  it('shows the tool text size controls', async () => {
    render(<SettingsView />);

    await waitFor(() => {
      expect(fetchProxyConfigMock).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByRole('button', { name: 'Default text size' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Large text size' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Extra large text size' })).toBeInTheDocument();
  });
});
