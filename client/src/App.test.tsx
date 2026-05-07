// App.test.tsx — Unit tests for the Phase 1 routed application shell.

import type { ReactNode } from 'react';
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

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: ReactNode }) => <>{children}</>,
  closestCenter: vi.fn(),
  MouseSensor: class {},
  TouchSensor: class {},
  useSensor: vi.fn(),
  useSensors: vi.fn(() => []),
}));

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: ReactNode }) => <>{children}</>,
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
  rectSortingStrategy: vi.fn(),
  arrayMove: (items: unknown[]) => items,
}));

import App from './App.tsx';
import { useSettingsStore } from './store/settingsStore.ts';

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
    window.localStorage.clear();
    useProxyStatusMock.mockReset();
    useRelayBridgeMock.mockReset();
    useProxyStatusMock.mockImplementation(() => undefined);
    useRelayBridgeMock.mockImplementation(() => undefined);
    useSettingsStore.setState({ homePersona: 'all', cardOrder: [], recentViews: [], theme: 'dark' });
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

  it('redirects unknown routes to the Home view', async () => {
    renderApp(UNKNOWN_PATH);

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Your personal utility belt' }),
      ).toBeInTheDocument();
    });
  });

  it('shows the NodeToolbox title in the header', () => {
    renderApp(DEFAULT_PATH);

    expect(screen.getByText('NodeToolbox')).toBeInTheDocument();
  });

  it('makes the NodeToolbox title a link that navigates to the Home route', () => {
    renderApp(DEFAULT_PATH);

    const homeLinkElement = screen.getByRole('link', { name: 'NodeToolbox' });
    expect(homeLinkElement).toBeInTheDocument();
    expect(homeLinkElement).toHaveAttribute('href', '/');
  });
});
