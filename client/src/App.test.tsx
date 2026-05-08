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

vi.mock('./views/SprintDashboard/SprintDashboardView.tsx', () => ({
  default: () => <h1>Sprint Dashboard Mock</h1>,
}));

vi.mock('./views/DevWorkspace/DevWorkspaceView.tsx', () => ({
  default: () => <h1>Dev Workspace Mock</h1>,
}));

vi.mock('./views/TextTools/TextToolsView.tsx', () => ({
  default: () => <h1>Text Tools Mock</h1>,
}));

vi.mock('./views/CodeWalkthrough/CodeWalkthroughView.tsx', () => ({
  default: () => <h1>Code Walkthrough Mock</h1>,
}));

vi.mock('./views/MyIssues/MyIssuesView.tsx', () => ({
  default: () => <h1>My Issues Mock</h1>,
}));

vi.mock('./views/ReportsHub/ReportsHubView.tsx', () => ({
  default: () => <h1>Reports Hub Mock</h1>,
}));

vi.mock('./views/AdminHub/AdminHubView.tsx', () => ({
  default: () => <h1>Admin Hub Mock</h1>,
}));

vi.mock('./views/DsuBoard/DsuBoardView.tsx', () => ({
  default: () => <h1>DSU Board Mock</h1>,
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

const REDIRECT_ROUTE_EXPECTATIONS = [
  { legacyPath: '/sprint-planning', headingName: 'Sprint Dashboard Mock' },
  { legacyPath: '/pointing', headingName: 'Sprint Dashboard Mock' },
  { legacyPath: '/standup', headingName: 'Sprint Dashboard Mock' },
  { legacyPath: '/dsu-daily', headingName: 'Sprint Dashboard Mock' },
  { legacyPath: '/metrics', headingName: 'Sprint Dashboard Mock' },
  { legacyPath: '/pipeline', headingName: 'Sprint Dashboard Mock' },
  { legacyPath: '/defects', headingName: 'Sprint Dashboard Mock' },
  { legacyPath: '/release-monitor', headingName: 'Sprint Dashboard Mock' },
  { legacyPath: '/work-log', headingName: 'Dev Workspace Mock' },
  { legacyPath: '/mermaid', headingName: 'Text Tools Mock' },
  { legacyPath: '/pitch-deck', headingName: 'Code Walkthrough Mock' },
  { legacyPath: '/hygiene', headingName: 'My Issues Mock' },
  { legacyPath: '/impact-analysis', headingName: 'Reports Hub Mock' },
  { legacyPath: '/dev-panel', headingName: 'Admin Hub Mock' },
] as const;

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

  it.each(REDIRECT_ROUTE_EXPECTATIONS)(
    'redirects $legacyPath to the consolidated parent view',
    async ({ legacyPath, headingName }) => {
      renderApp(legacyPath);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: headingName })).toBeInTheDocument();
      });
    },
  );

  it('keeps the reports hub route accessible', async () => {
    renderApp('/reports-hub');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Reports Hub Mock' })).toBeInTheDocument();
    });
  });

  it('keeps the dsu-board route accessible', async () => {
    renderApp('/dsu-board');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'DSU Board Mock' })).toBeInTheDocument();
    });
  });
});
