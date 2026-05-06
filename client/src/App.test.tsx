// App.test.tsx — Unit tests for the Phase 1 routed application shell.

import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { useProxyStatusMock, useRelayBridgeMock } = vi.hoisted(() => ({
  useProxyStatusMock: vi.fn(),
  useRelayBridgeMock: vi.fn(),
}));

vi.mock('./hooks/useProxyStatus.ts', () => ({
  useProxyStatus: useProxyStatusMock,
}));

vi.mock('./hooks/useRelayBridge.ts', () => ({
  useRelayBridge: useRelayBridgeMock,
}));

import App from './App.tsx';

const DEFAULT_PATH = '/';
const UNKNOWN_PATH = '/unknown';
const MOCK_PROXY_STATUS_RESPONSE = {
  version: '0.4.0',
  jiraConfigured: true,
  snowConfigured: true,
  confluenceConfigured: true,
  schedulerEnabled: true,
};

function renderApp(initialPath: string): void {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <App />
    </MemoryRouter>,
  );
}

describe('App shell', () => {
  beforeEach(() => {
    useProxyStatusMock.mockReset();
    useRelayBridgeMock.mockReset();
    useProxyStatusMock.mockImplementation(() => undefined);
    useRelayBridgeMock.mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => MOCK_PROXY_STATUS_RESPONSE,
      }),
    );
  });

  it('renders without crashing and mounts the global polling hooks', () => {
    renderApp(DEFAULT_PATH);

    expect(screen.getByText('NodeToolbox')).toBeInTheDocument();
    expect(useProxyStatusMock).toHaveBeenCalledTimes(1);
    expect(useRelayBridgeMock).toHaveBeenCalledWith('snow');
  });

  it('renders the ConnectionBar in the header', () => {
    renderApp(DEFAULT_PATH);

    expect(screen.getByLabelText('Connection status')).toBeInTheDocument();
  });

  it('redirects unknown routes to the home placeholder view', async () => {
    renderApp(UNKNOWN_PATH);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument();
    });
  });

  it('shows the NodeToolbox title in the header', () => {
    renderApp(DEFAULT_PATH);

    expect(screen.getByText('NodeToolbox')).toBeInTheDocument();
  });
});
