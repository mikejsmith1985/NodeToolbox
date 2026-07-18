// App.test.tsx — Unit tests for the Phase 1 routed application shell.

import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
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

vi.mock('./views/PoTool/PoToolView.tsx', () => ({
  default: () => <h1>PO Tool Mock</h1>,
}));

vi.mock('./views/ArtView/ArtView.tsx', () => ({
  default: () => <h1>ART View Mock</h1>,
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

vi.mock('./views/PersonalToolbox/PersonalToolboxView.tsx', () => ({
  default: () => <h1>Personal Toolbox Mock</h1>,
}));

vi.mock('./views/AgileHub/search/SimpleSearchTab.tsx', () => ({
  default: () => <h1>Simple Search Mock</h1>,
}));

vi.mock('./views/JiraTemplateMaker/JiraTemplateMaker.tsx', () => ({
  default: () => <h1>Template Maker Mock</h1>,
}));

vi.mock('./views/JiraIntake/JiraIntake.tsx', () => ({
  default: () => <h1>Jira Intake Mock</h1>,
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

vi.mock('./views/SnowHub/SnowHubView.tsx', () => ({
  default: () => <h1>SNow Hub Mock</h1>,
}));

import App from './App.tsx';
import { RELAY_RETURN_ROUTE_KEY } from './services/browserRelay.ts';
import { useAdminStore } from './store/adminStore.ts';
import { useSettingsStore } from './store/settingsStore.ts';
import { setToolVisibility, useToolVisibilityStore } from './store/toolVisibilityStore.ts';

const DEFAULT_PATH = '/';
const UNKNOWN_PATH = '/unknown';
const MOCK_PROXY_STATUS_RESPONSE = {
  version: '0.4.0',
  sslVerify: true,
  jira: { configured: true, hasCredentials: true, ready: true, baseUrl: 'https://jira.example.com' },
  snow: { configured: true, hasCredentials: true, ready: true, sessionMode: false, sessionExpiresAt: null, baseUrl: 'https://snow.example.com' },
  github: { configured: false, hasCredentials: false, ready: false },
  confluence: { configured: true, hasCredentials: true, ready: true, baseUrl: 'https://confluence.example.com' },
};

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{`${location.pathname}${location.search}`}</div>;
}

function renderApp(initialPath: string): void {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <App />
      <LocationProbe />
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
  { legacyPath: '/work-log', headingName: 'My Issues Mock' },
  { legacyPath: '/mermaid', headingName: 'Text Tools Mock' },
  { legacyPath: '/pitch-deck', headingName: 'Code Walkthrough Mock' },
  { legacyPath: '/hygiene', headingName: 'My Issues Mock' },
  { legacyPath: '/impact-analysis', headingName: 'Reports Hub Mock' },
  { legacyPath: '/dev-panel', headingName: 'Admin Hub Mock' },
] as const;

describe('App shell', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
    useProxyStatusMock.mockReset();
    useRelayBridgeMock.mockReset();
    useProxyStatusMock.mockImplementation(() => undefined);
    useRelayBridgeMock.mockImplementation(() => undefined);
    useSettingsStore.setState({ cardOrder: [], recentViews: [], theme: 'dark', toolTextSize: 'default', agileHubLastSpace: 'team' });
    useAdminStore.setState({ isAdminUnlocked: false });
    useToolVisibilityStore.setState({ visibilityByCardId: {} });
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

  it('shows a demo mode badge when the current tab is isolated for first-install demos', () => {
    window.sessionStorage.setItem('ntbx-demo-mode-enabled', '1');

    renderApp(DEFAULT_PATH);

    expect(screen.getByText('Demo mode')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Exit' })).toBeInTheDocument();
  });

  it('shows a global theme toggle and switches the html theme attribute', async () => {
    renderApp(DEFAULT_PATH);

    const darkThemeButton = screen.getByRole('button', { name: 'Dark' });
    const lightThemeButton = screen.getByRole('button', { name: 'Light' });

    expect(darkThemeButton).toHaveAttribute('aria-pressed', 'true');
    expect(lightThemeButton).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(lightThemeButton);

    await waitFor(() => {
      expect(useSettingsStore.getState().theme).toBe('light');
      expect(document.documentElement).toHaveAttribute('data-theme', 'light');
      expect(lightThemeButton).toHaveAttribute('aria-pressed', 'true');
      expect(darkThemeButton).toHaveAttribute('aria-pressed', 'false');
    });
  });

  it('shows a global tool text size toggle and switches the html text size attribute', async () => {
    renderApp(DEFAULT_PATH);

    const defaultTextSizeButton = screen.getByRole('button', { name: 'Default text size' });
    const largeTextSizeButton = screen.getByRole('button', { name: 'Large text size' });
    const extraLargeTextSizeButton = screen.getByRole('button', { name: 'Extra large text size' });

    expect(defaultTextSizeButton).toHaveAttribute('aria-pressed', 'true');
    expect(largeTextSizeButton).toHaveAttribute('aria-pressed', 'false');
    expect(extraLargeTextSizeButton).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(largeTextSizeButton);

    await waitFor(() => {
      expect(useSettingsStore.getState().toolTextSize).toBe('large');
      expect(document.documentElement).toHaveAttribute('data-tool-text-size', 'large');
      expect(defaultTextSizeButton).toHaveAttribute('aria-pressed', 'false');
      expect(largeTextSizeButton).toHaveAttribute('aria-pressed', 'true');
    });
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

  it('keeps the personal toolbox route accessible', async () => {
    renderApp('/personal-toolbox');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Personal Toolbox Mock' })).toBeInTheDocument();
    });
  });

  // ── Card consolidation: Business Helper → Agile Hub Search; Templates + Intake → Jira Create ──

  it('redirects /business-helper into the Agile Hub Search space (Simple Search survives)', async () => {
    renderApp('/business-helper');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Simple Search Mock' })).toBeInTheDocument();
    });
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/agile-hub?space=search');
  });

  it('serves the merged Jira Create tool with Templates as the default tab', async () => {
    renderApp('/jira-create');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Template Maker Mock' })).toBeInTheDocument();
    });
  });

  it('redirects /jira-template-maker to Jira Create preserving the query string', async () => {
    renderApp('/jira-template-maker?template=abc123');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Template Maker Mock' })).toBeInTheDocument();
    });
    const landedLocation = screen.getByTestId('location-probe').textContent ?? '';
    expect(landedLocation).toContain('/jira-create');
    expect(landedLocation).toContain('tab=templates');
    expect(landedLocation).toContain('template=abc123');
  });

  it('redirects /jira-intake to the Jira Create Intake tab', async () => {
    renderApp('/jira-intake');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Jira Intake Mock' })).toBeInTheDocument();
    });
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/jira-create?tab=intake');
  });

  it('restores the pre-relay route after the bookmarklet reloads the window to root', async () => {
    // The user was inside SNow Hub, so this tab necessarily holds the admin unlock (spec 020 gate).
    useAdminStore.setState({ isAdminUnlocked: true });
    // Simulate what openSnowRelay() writes before the bookmarklet triggers a page reload
    localStorage.setItem(RELAY_RETURN_ROUTE_KEY, JSON.stringify({ path: '/snow-hub', createdAt: Date.now() }));

    renderApp(DEFAULT_PATH);

    // App should navigate away from '/' to the stored return route
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'SNow Hub Mock' })).toBeInTheDocument();
    });

    // Key must be cleared so subsequent loads don't redirect again
    expect(localStorage.getItem(RELAY_RETURN_ROUTE_KEY)).toBeNull();
  });

  // ── Spec 020 US1: honest route gating ──

  it('lands direct /snow-hub navigation on the home page while Admin Hub is locked (FR-002)', async () => {
    renderApp('/snow-hub');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Your personal utility belt' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('heading', { name: 'SNow Hub Mock' })).not.toBeInTheDocument();
  });

  it('admits /snow-hub while the session holds the admin unlock', async () => {
    useAdminStore.setState({ isAdminUnlocked: true });

    renderApp('/snow-hub');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'SNow Hub Mock' })).toBeInTheDocument();
    });
  });

  it('lands a visibility-hidden tool\'s route on the home page (FR-005)', async () => {
    setToolVisibility('text-tools', false);

    renderApp('/text-tools');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Your personal utility belt' })).toBeInTheDocument();
    });
  });

  it('hiding one tool never breaks other routes — cross-tool flows keep working (FR-004)', async () => {
    setToolVisibility('my-issues', false);

    renderApp('/dsu-board');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'DSU Board Mock' })).toBeInTheDocument();
    });
  });

  // ── Spec 020 US3: retired routes redirect into Agile Hub spaces with params intact ──

  it('redirects /sprint-dashboard into the Team space preserving the query string (FR-010)', async () => {
    renderApp('/sprint-dashboard?hygieneFilter=stale');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Sprint Dashboard Mock' })).toBeInTheDocument();
    });
    const landedLocation = screen.getByTestId('location-probe').textContent ?? '';
    expect(landedLocation).toContain('/agile-hub');
    expect(landedLocation).toContain('hygieneFilter=stale');
    expect(landedLocation).toContain('space=team');
  });

  it('redirects /po-tool into the Product space', async () => {
    renderApp('/po-tool');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'PO Tool Mock' })).toBeInTheDocument();
    });
    expect(screen.getByTestId('location-probe')).toHaveTextContent('space=product');
  });

  it('redirects /art into the Train space', async () => {
    renderApp('/art');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'ART View Mock' })).toBeInTheDocument();
    });
    expect(screen.getByTestId('location-probe')).toHaveTextContent('space=train');
  });

  it.each(['/standup', '/metrics'])('repoints the legacy path %s to the Team space in one hop', async (legacyPath) => {
    renderApp(legacyPath);

    await waitFor(() => {
      expect(screen.getByTestId('location-probe')).toHaveTextContent('/agile-hub?space=team');
    });
    expect(screen.getByRole('heading', { name: 'Sprint Dashboard Mock' })).toBeInTheDocument();
  });

  it('ignores stale plain-text relay return routes from older releases', () => {
    localStorage.setItem(RELAY_RETURN_ROUTE_KEY, '/snow-hub');

    renderApp(DEFAULT_PATH);

    expect(screen.getByRole('heading', { name: 'Your personal utility belt' })).toBeInTheDocument();
    expect(localStorage.getItem(RELAY_RETURN_ROUTE_KEY)).toBeNull();
  });
});
