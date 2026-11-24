// ConnectionBar.test.tsx — Unit tests for the compact global connection status bar.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { useAdminStore } from '../../store/adminStore.ts';
import { useConnectionStore } from '../../store/connectionStore.ts';
import { saveSharePointSiteUrl } from '../../services/sharePointSiteUrl.ts';
import type { ProxyStatusResponse } from '../../types/config.ts';
import { ConnectionBar } from './ConnectionBar.tsx';
import styles from './ConnectionBar.module.css';

const { openSnowRelayMock, openSharePointRelayMock, openJiraRelayMock, saveServiceBaseUrlMock } = vi.hoisted(() => ({
  openSnowRelayMock: vi.fn(),
  openSharePointRelayMock: vi.fn(),
  openJiraRelayMock: vi.fn(),
  saveServiceBaseUrlMock: vi.fn(),
}));

vi.mock('../../services/proxyApi.ts', () => ({
  saveServiceBaseUrl: saveServiceBaseUrlMock,
}));

vi.mock('../../services/browserRelay.ts', () => ({
  SNOW_RELAY_BOOKMARKLET_CODE: 'javascript:mockRelay()',
  SHAREPOINT_RELAY_BOOKMARKLET_CODE: 'javascript:mockSharePointRelay()',
  // One bookmarklet now serves both systems; the panels install this rather than a per-system one.
  UNIFIED_RELAY_BOOKMARKLET_CODE: 'javascript:mockUnifiedRelay()',
  openSnowRelay: openSnowRelayMock,
  openSharePointRelay: openSharePointRelayMock,
  openJiraRelay: openJiraRelayMock,
}));

// ── Helpers ──

function setJiraRelay(relayFields: { isConnected: boolean; isAuthorized: boolean; relayOrigin: string }): void {
  useConnectionStore.setState({
    relayStatusBySystem: {
      jira: { system: 'jira', lastPingAt: '2026-11-24T10:00:00.000Z', version: null, ...relayFields },
    },
  });
}

function setJiraBaseUrl(jiraBaseUrl: string): void {
  useConnectionStore.setState({
    proxyStatus: { jira: { baseUrl: jiraBaseUrl } } as unknown as ProxyStatusResponse,
  });
}

function resetConnectionStore(): void {
  useConnectionStore.setState(useConnectionStore.getInitialState());
}

function resetAdminStore(): void {
  useAdminStore.setState({ isAdminUnlocked: false });
}

/** Builds a minimal ProxyStatusResponse with the given SNow base URL for test setups. */
function buildProxyStatusWithSnowUrl(snowBaseUrl: string): ProxyStatusResponse {
  return {
    version: '0.0.0',
    sslVerify: true,
    jira: { configured: false, hasCredentials: false, ready: false },
    snow: {
      configured: true,
      hasCredentials: false,
      ready: false,
      sessionMode: false,
      sessionExpiresAt: null,
      baseUrl: snowBaseUrl,
    },
    github: { configured: false, hasCredentials: false, ready: false, probeCheckedAt: null },
    confluence: { configured: false, hasCredentials: false, ready: false },
  };
}

describe('ConnectionBar', () => {
  beforeEach(() => {
    resetConnectionStore();
    resetAdminStore();
    openSnowRelayMock.mockReset();
    openSnowRelayMock.mockReturnValue(true);
    vi.spyOn(window, 'alert').mockImplementation(() => undefined);
  });

  // ── Visibility gating ──

  it('always renders Jira and Confluence indicators', () => {
    render(<ConnectionBar />);

    expect(screen.getByText('Jira')).toBeInTheDocument();
    expect(screen.getByText('Confluence')).toBeInTheDocument();
  });

  it('shows the SNow indicator without the admin unlock — its gate is paused (2026-09-05) — but still hides GitHub', () => {
    // A SNow Hub you can open needs the relay panel that connects it.
    render(<ConnectionBar />);

    expect(screen.getByText('SNow')).toBeInTheDocument();
    expect(screen.queryByText('GitHub')).not.toBeInTheDocument();
  });

  it('opens the SNow panel without the admin unlock', () => {
    render(<ConnectionBar />);

    fireEvent.click(screen.getByText('SNow'));

    expect(screen.getByRole('region', { name: 'Connection details' })).toBeInTheDocument();
  });

  it('shows SNow and GitHub indicators when admin is unlocked', () => {
    useAdminStore.setState({ isAdminUnlocked: true });

    render(<ConnectionBar />);

    expect(screen.getByText('SNow')).toBeInTheDocument();
    expect(screen.getByText('GitHub')).toBeInTheDocument();
  });

  it('does not render a standalone Relay indicator', () => {
    render(<ConnectionBar />);

    expect(screen.queryByText('Relay')).not.toBeInTheDocument();
  });

  // ── Jira indicator ──

  // The Jira light used to go green whenever ANY credential was stored — including a token for the OLD Jira
  // instance after a migration, which made it a lie. It now works like SNow: green only while a Jira tab is
  // relaying and Jira is accepting its calls.

  it('shows Jira as not ready with a stored token but no Jira relay', () => {
    useConnectionStore.setState({ isJiraReady: true });

    render(<ConnectionBar />);

    expect(screen.getByText('Jira')).toHaveClass(styles.notReady);
  });

  it('shows Jira as ready when a live call with the stored token succeeds, and names where it went', () => {
    // A token for the NEW Jira is as good as the relay — but only once a real call proved it, never because a
    // token merely exists. The panel names the URL so a token for the wrong Jira cannot hide.
    setJiraBaseUrl('https://jira.new.example.com');
    useConnectionStore.setState({ isJiraVerified: true });
    render(<ConnectionBar />);

    expect(screen.getByText('Jira')).toHaveClass(styles.ready);
    fireEvent.click(screen.getByText('Jira'));
    expect(screen.getByText(/stored token at https:\/\/jira\.new\.example\.com/)).toBeInTheDocument();
  });

  it('shows Jira as ready while a Jira tab is relaying and Jira accepts the calls', () => {
    setJiraRelay({ isConnected: true, isAuthorized: true, relayOrigin: 'https://jira.new.example.com' });

    render(<ConnectionBar />);

    expect(screen.getByText('Jira')).toHaveClass(styles.ready);
  });

  it('shows Jira as not ready when the relay is alive but Jira refuses it', () => {
    setJiraRelay({ isConnected: true, isAuthorized: false, relayOrigin: 'https://jira.new.example.com' });

    render(<ConnectionBar />);

    expect(screen.getByText('Jira')).toHaveClass(styles.notReady);
  });

  it('offers to open a dedicated Jira relay tab at the configured Jira address', () => {
    setJiraBaseUrl('https://jira.new.example.com');
    render(<ConnectionBar />);

    fireEvent.click(screen.getByText('Jira'));
    fireEvent.click(screen.getByRole('button', { name: /open jira/i }));

    expect(openJiraRelayMock).toHaveBeenCalledWith('https://jira.new.example.com');
  });

  it('names the stale stored Jira URL and saves the relay\u2019s address in one click', async () => {
    setJiraBaseUrl('https://jira.old.example.com');
    setJiraRelay({ isConnected: true, isAuthorized: true, relayOrigin: 'https://jira.new.example.com' });
    saveServiceBaseUrlMock.mockResolvedValue(undefined);
    render(<ConnectionBar />);

    fireEvent.click(screen.getByText('Jira'));
    expect(screen.getByText(/https:\/\/jira\.old\.example\.com/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /use https:\/\/jira\.new\.example\.com/i }));

    expect(saveServiceBaseUrlMock).toHaveBeenCalledWith('jira', 'https://jira.new.example.com');
    expect(await screen.findByText(/Jira URL saved/i)).toBeInTheDocument();
  });

  // ── SNow indicator (admin-gated) ──

  it('keeps SNow not ready when only the direct proxy probe has verified the connection', () => {
    useAdminStore.setState({ isAdminUnlocked: true });
    useConnectionStore.setState({ isSnowVerified: true });

    render(<ConnectionBar />);

    expect(screen.getByText('SNow')).toHaveClass(styles.notReady);
  });

  it('shows SNow as ready when relay bridge is active', () => {
    useAdminStore.setState({ isAdminUnlocked: true });
    useConnectionStore.setState({
      isSnowVerified: false,
      relayBridgeStatus: { isConnected: true, lastPingAt: null, system: 'snow', version: null },
    });

    render(<ConnectionBar />);

    expect(screen.getByText('SNow')).toHaveClass(styles.ready);
  });

  it('warns when the SNow relay is active before the g_ck token is ready', () => {
    useAdminStore.setState({ isAdminUnlocked: true });
    useConnectionStore.setState({
      relayBridgeStatus: {
        isConnected: true,
        lastPingAt: null,
        system: 'snow',
        version: null,
        hasSessionToken: false,
      },
    });

    render(<ConnectionBar />);
    fireEvent.click(screen.getByText('SNow'));

    expect(screen.getByText(/session token is not ready/i)).toBeInTheDocument();
  });

  it('names a relay running on a different ServiceNow instance, while it still reads connected (GH #377)', () => {
    // The whole false positive: the bookmarklet polls perfectly from the wrong tab, so the panel
    // says reachable while every call it relays lands somewhere that cannot answer.
    useAdminStore.setState({ isAdminUnlocked: true });
    useConnectionStore.setState({
      proxyStatus: buildProxyStatusWithSnowUrl('https://acme.service-now.com'),
      relayBridgeStatus: {
        isConnected: true, lastPingAt: null, system: 'snow', version: null,
        hasSessionToken: true, relayOrigin: 'https://acme-dev.service-now.com',
      },
    });

    render(<ConnectionBar />);
    fireEvent.click(screen.getByText('SNow'));

    expect(screen.getByRole('alert').textContent).toMatch(/acme-dev\.service-now\.com/);
    expect(screen.getByRole('alert').textContent).toMatch(/look connected and every call will fail/i);
  });

  it('stays quiet when the relay is on the instance ServiceNow is configured as', () => {
    useAdminStore.setState({ isAdminUnlocked: true });
    useConnectionStore.setState({
      proxyStatus: buildProxyStatusWithSnowUrl('https://acme.service-now.com'),
      relayBridgeStatus: {
        isConnected: true, lastPingAt: null, system: 'snow', version: null,
        hasSessionToken: true, relayOrigin: 'https://acme.service-now.com',
      },
    });

    render(<ConnectionBar />);
    fireEvent.click(screen.getByText('SNow'));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('opens the SNow panel when the SNow indicator is clicked', () => {
    useAdminStore.setState({ isAdminUnlocked: true });

    render(<ConnectionBar />);
    fireEvent.click(screen.getByText('SNow'));

    expect(screen.getByRole('region', { name: 'Connection details' })).toBeInTheDocument();
  });

  it('shows bookmarklet drag instructions in the SNow panel when relay is inactive', () => {
    useAdminStore.setState({ isAdminUnlocked: true });

    render(<ConnectionBar />);
    fireEvent.click(screen.getByText('SNow'));

    const panel = screen.getByRole('region', { name: 'Connection details' });
    expect(panel.textContent).toMatch(/[Dd]rag|bookmark/);
  });

  it('shows Open ServiceNow button in SNow panel when snow URL is configured and relay is inactive', () => {
    useAdminStore.setState({ isAdminUnlocked: true });
    useConnectionStore.setState({
      proxyStatus: buildProxyStatusWithSnowUrl('https://snow.example.com'),
    });

    render(<ConnectionBar />);
    fireEvent.click(screen.getByText('SNow'));

    expect(screen.getByRole('button', { name: /Open ServiceNow/i })).toBeInTheDocument();
  });

  it('opens the configured ServiceNow URL through the named relay window flow', () => {
    useAdminStore.setState({ isAdminUnlocked: true });
    useConnectionStore.setState({
      proxyStatus: buildProxyStatusWithSnowUrl('https://snow.example.com'),
    });

    render(<ConnectionBar />);
    fireEvent.click(screen.getByText('SNow'));
    fireEvent.click(screen.getByRole('button', { name: /Open ServiceNow/i }));

    expect(openSnowRelayMock).toHaveBeenCalledWith('https://snow.example.com');
  });

  it('does not render the confusing Copy Code relay action', () => {
    useAdminStore.setState({ isAdminUnlocked: true });

    render(<ConnectionBar />);
    fireEvent.click(screen.getByText('SNow'));

    expect(screen.queryByRole('button', { name: /copy code/i })).not.toBeInTheDocument();
  });

  it('explains that the bookmarklet must be dragged when clicked inside NodeToolbox', () => {
    useAdminStore.setState({ isAdminUnlocked: true });

    render(<ConnectionBar />);
    fireEvent.click(screen.getByText('SNow'));
    fireEvent.click(screen.getByRole('link', { name: /Toolbox Relay/i }));

    expect(window.alert).toHaveBeenCalledWith(expect.stringMatching(/Drag "Toolbox Relay"/));
  });

  it('keeps the real bookmarklet URL available for browser drag-to-bookmarks install', () => {
    useAdminStore.setState({ isAdminUnlocked: true });

    render(<ConnectionBar />);
    fireEvent.click(screen.getByText('SNow'));

    const bookmarkletLink = screen.getByRole('link', { name: /Toolbox Relay/i });

    expect(bookmarkletLink.getAttribute('href')).toBe('javascript:mockUnifiedRelay()');
  });

  it('does not show Open ServiceNow button when relay is already active', () => {
    useAdminStore.setState({ isAdminUnlocked: true });
    useConnectionStore.setState({
      relayBridgeStatus: { isConnected: true, lastPingAt: null, system: 'snow', version: null, hasSessionToken: true },
      proxyStatus: buildProxyStatusWithSnowUrl('https://snow.example.com'),
    });

    render(<ConnectionBar />);
    fireEvent.click(screen.getByText('SNow'));

    expect(screen.queryByRole('button', { name: /Open ServiceNow/i })).not.toBeInTheDocument();
  });

  it('closes the SNow panel when the SNow indicator is clicked a second time', () => {
    useAdminStore.setState({ isAdminUnlocked: true });

    render(<ConnectionBar />);
    fireEvent.click(screen.getByText('SNow'));
    expect(screen.getByRole('region', { name: 'Connection details' })).toBeInTheDocument();

    fireEvent.click(screen.getByText('SNow'));
    expect(screen.queryByRole('region', { name: 'Connection details' })).not.toBeInTheDocument();
  });

  // ── Confluence indicator ──

  it('shows Confluence indicator as not ready when no Confluence credentials are configured', () => {
    render(<ConnectionBar />);

    expect(screen.getByText('Confluence')).toHaveClass(styles.notReady);
  });

  it('shows Confluence indicator as ready when isConfluenceReady is true', () => {
    useConnectionStore.setState({ isConfluenceReady: true });

    render(<ConnectionBar />);

    expect(screen.getByText('Confluence')).toHaveClass(styles.ready);
  });

  it('opens the Confluence panel when the Confluence indicator is clicked', () => {
    render(<ConnectionBar />);

    fireEvent.click(screen.getByText('Confluence'));

    expect(screen.getByRole('region', { name: 'Connection details' })).toBeInTheDocument();
  });

  it('shows a hint to configure Confluence when not ready', () => {
    render(<ConnectionBar />);
    fireEvent.click(screen.getByText('Confluence'));

    const panel = screen.getByRole('region', { name: 'Connection details' });
    expect(panel.textContent).toMatch(/Admin Hub/i);
  });

  it('shows Open Confluence button when Confluence is ready and a base URL is configured', () => {
    useConnectionStore.setState({
      isConfluenceReady: true,
      proxyStatus: {
        version: '0.0.0',
        sslVerify: true,
        jira: { configured: false, hasCredentials: false, ready: false },
        snow: { configured: false, hasCredentials: false, ready: false, sessionMode: false, sessionExpiresAt: null, baseUrl: null },
        github: { configured: false, hasCredentials: false, ready: false, probeCheckedAt: null },
        confluence: { configured: true, hasCredentials: true, ready: true, baseUrl: 'https://mysite.atlassian.net/' },
      },
    });

    render(<ConnectionBar />);
    fireEvent.click(screen.getByText('Confluence'));

    expect(screen.getByRole('button', { name: /Open Confluence/i })).toBeInTheDocument();
  });

  // ── GitHub indicator (admin-gated) ──

  it('shows GitHub indicator as not ready when admin is unlocked but no PAT is configured', () => {
    useAdminStore.setState({ isAdminUnlocked: true });

    render(<ConnectionBar />);

    expect(screen.getByText('GitHub')).toHaveClass(styles.notReady);
  });

  it('shows GitHub indicator as ready when admin is unlocked and isGitHubReady is true', () => {
    useAdminStore.setState({ isAdminUnlocked: true });
    useConnectionStore.setState({ isGitHubReady: true });

    render(<ConnectionBar />);

    expect(screen.getByText('GitHub')).toHaveClass(styles.ready);
  });

  it('opens the GitHub panel when the GitHub indicator is clicked', () => {
    useAdminStore.setState({ isAdminUnlocked: true });

    render(<ConnectionBar />);
    fireEvent.click(screen.getByText('GitHub'));

    expect(screen.getByRole('region', { name: 'Connection details' })).toBeInTheDocument();
  });

  it('shows a hint to configure GitHub when not ready', () => {
    useAdminStore.setState({ isAdminUnlocked: true });

    render(<ConnectionBar />);
    fireEvent.click(screen.getByText('GitHub'));

    const panel = screen.getByRole('region', { name: 'Connection details' });
    expect(panel.textContent).toMatch(/Admin Hub/i);
  });

  // ── SharePoint relay (feature 008) ──

  it('always shows the SharePoint indicator and opens a panel with the draggable bookmarklet when disconnected', () => {
    render(<ConnectionBar />);
    fireEvent.click(screen.getByText('SharePoint'));

    const panel = screen.getByRole('region', { name: 'Connection details' });
    expect(panel.textContent).toMatch(/not connected/i);
    expect(screen.getByRole('link', { name: /Toolbox Relay/i })).toBeInTheDocument();
  });

  it('reflects the SharePoint relay connected state from the per-system store', () => {
    useConnectionStore.setState({
      relayStatusBySystem: { sharepoint: { system: 'sharepoint', isConnected: true, lastPingAt: null, version: null } },
    });
    render(<ConnectionBar />);
    fireEvent.click(screen.getByText('SharePoint'));
    expect(screen.getByRole('region', { name: 'Connection details' }).textContent).toMatch(/connected/i);
  });

  it('tracks SharePoint and ServiceNow relay status independently (no cross-contamination)', () => {
    useAdminStore.setState({ isAdminUnlocked: true }); // SNow indicator visible
    // SharePoint connected, ServiceNow NOT — the SharePoint update must not flip SNow on.
    useConnectionStore.setState({
      relayBridgeStatus: null,
      relayStatusBySystem: { sharepoint: { system: 'sharepoint', isConnected: true, lastPingAt: null, version: null } },
    });
    render(<ConnectionBar />);

    fireEvent.click(screen.getByText('SharePoint'));
    expect(screen.getByRole('region', { name: 'Connection details' }).textContent).toMatch(/SharePoint relay connected/i);

    fireEvent.click(screen.getByText('SNow'));
    expect(screen.getByRole('region', { name: 'Connection details' }).textContent).toMatch(/not reachable|not connected/i);
  });

  it('offers "Open SharePoint" only when a full site URL is configured', () => {
    // No configured URL → no Open button.
    localStorage.clear();
    const { unmount } = render(<ConnectionBar />);
    fireEvent.click(screen.getByText('SharePoint'));
    expect(screen.queryByRole('button', { name: /open sharepoint/i })).not.toBeInTheDocument();
    unmount();

    // Configured full URL → Open button opens it via the named-window relay helper (same
    // browsing-context group as SNow, so the bookmarklet can focus Toolbox back afterwards).
    saveSharePointSiteUrl('https://contoso.sharepoint.com/sites/CUCIntake');
    render(<ConnectionBar />);
    fireEvent.click(screen.getByText('SharePoint'));
    fireEvent.click(screen.getByRole('button', { name: /open sharepoint/i }));
    expect(openSharePointRelayMock).toHaveBeenCalledWith('https://contoso.sharepoint.com/sites/CUCIntake');
    localStorage.clear();
  });
});
