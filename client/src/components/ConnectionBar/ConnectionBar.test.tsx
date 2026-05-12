// ConnectionBar.test.tsx — Unit tests for the compact global connection status bar.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { useConnectionStore } from '../../store/connectionStore.ts';
import type { ProxyStatusResponse } from '../../types/config.ts';
import { ConnectionBar } from './ConnectionBar.tsx';
import styles from './ConnectionBar.module.css';

const { openSnowRelayMock } = vi.hoisted(() => ({
  openSnowRelayMock: vi.fn(),
}));

vi.mock('../../services/browserRelay.ts', () => ({
  SNOW_RELAY_BOOKMARKLET_CODE: 'javascript:mockRelay()',
  openSnowRelay: openSnowRelayMock,
}));

// ── Helpers ──

function resetConnectionStore(): void {
  useConnectionStore.setState(useConnectionStore.getInitialState());
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
    github: { configured: false, hasCredentials: false, ready: false },
    confluence: { configured: false, hasCredentials: false, ready: false },
  };
}

describe('ConnectionBar', () => {
  beforeEach(() => {
    resetConnectionStore();
    openSnowRelayMock.mockReset();
    openSnowRelayMock.mockReturnValue(true);
    vi.spyOn(window, 'alert').mockImplementation(() => undefined);
  });

  it('renders three connection indicators', () => {
    render(<ConnectionBar />);

    expect(screen.getByText('Jira')).toBeInTheDocument();
    expect(screen.getByText('SNow')).toBeInTheDocument();
    expect(screen.getByText('Relay')).toBeInTheDocument();
  });

  it('shows the Jira indicator as ready when Jira is configured in the backend', () => {
    useConnectionStore.setState({ isJiraReady: true });

    render(<ConnectionBar />);

    expect(screen.getByText('Jira')).toHaveClass(styles.ready);
  });

  it('shows the Jira indicator as not ready when Jira is not configured', () => {
    render(<ConnectionBar />);

    expect(screen.getByText('Jira')).toHaveClass(styles.notReady);
  });

  it('keeps SNow not ready when only the direct proxy probe has verified the connection', () => {
    useConnectionStore.setState({ isSnowVerified: true });

    render(<ConnectionBar />);

    expect(screen.getByText('SNow')).toHaveClass(styles.notReady);
  });

  it('shows SNow as not ready when credentials exist but probe has not verified', () => {
    // isSnowReady = credentials present but isSnowVerified is still false
    useConnectionStore.setState({ isSnowReady: true, isSnowVerified: false });

    render(<ConnectionBar />);

    expect(screen.getByText('SNow')).toHaveClass(styles.notReady);
  });

  it('shows SNow as ready when relay bridge is active even without direct verification', () => {
    useConnectionStore.setState({
      isSnowVerified: false,
      relayBridgeStatus: { isConnected: true, lastPingAt: null, system: 'snow', version: null },
    });

    render(<ConnectionBar />);

    expect(screen.getByText('SNow')).toHaveClass(styles.ready);
    expect(screen.getByText('Relay')).toHaveClass(styles.ready);
  });

  it('opens the relay panel when the Relay indicator is clicked', () => {
    render(<ConnectionBar />);

    fireEvent.click(screen.getByText('Relay'));

    expect(screen.getByRole('region', { name: 'Connection details' })).toBeInTheDocument();
  });

  it('shows bookmarklet drag instructions in the relay panel when relay is inactive', () => {
    render(<ConnectionBar />);

    fireEvent.click(screen.getByText('Relay'));

    // Panel should contain drag/bookmark instructions
    const panel = screen.getByRole('region', { name: 'Connection details' });
    expect(panel.textContent).toMatch(/[Dd]rag|bookmark/);
  });

  it('shows Open ServiceNow button in relay panel when snow URL is configured and relay is inactive', () => {
    useConnectionStore.setState({
      proxyStatus: buildProxyStatusWithSnowUrl('https://snow.example.com'),
    });

    render(<ConnectionBar />);
    fireEvent.click(screen.getByText('Relay'));

    expect(screen.getByRole('button', { name: /Open ServiceNow/i })).toBeInTheDocument();
  });

  it('opens the configured ServiceNow URL through the named relay window flow', () => {
    useConnectionStore.setState({
      proxyStatus: buildProxyStatusWithSnowUrl('https://snow.example.com'),
    });

    render(<ConnectionBar />);
    fireEvent.click(screen.getByText('Relay'));
    fireEvent.click(screen.getByRole('button', { name: /Open ServiceNow/i }));

    expect(openSnowRelayMock).toHaveBeenCalledWith('https://snow.example.com');
  });

  it('does not render the confusing Copy Code relay action', () => {
    render(<ConnectionBar />);
    fireEvent.click(screen.getByText('Relay'));

    expect(screen.queryByRole('button', { name: /copy code/i })).not.toBeInTheDocument();
  });

  it('explains that the bookmarklet must be dragged when clicked inside NodeToolbox', () => {
    render(<ConnectionBar />);
    fireEvent.click(screen.getByText('Relay'));
    fireEvent.click(screen.getByRole('link', { name: /NodeToolbox SNow Relay/i }));

    expect(window.alert).toHaveBeenCalledWith(expect.stringMatching(/Drag "NodeToolbox SNow Relay"/));
  });

  it('keeps the real bookmarklet URL available for browser drag-to-bookmarks install', () => {
    render(<ConnectionBar />);
    fireEvent.click(screen.getByText('Relay'));

    const bookmarkletLink = screen.getByRole('link', { name: /NodeToolbox SNow Relay/i });

    expect(bookmarkletLink.getAttribute('href')).toBe('javascript:mockRelay()');
  });

  it('does not show Open ServiceNow button when relay is already active', () => {
    useConnectionStore.setState({
      relayBridgeStatus: { isConnected: true, lastPingAt: null, system: 'snow', version: null },
      proxyStatus: buildProxyStatusWithSnowUrl('https://snow.example.com'),
    });

    render(<ConnectionBar />);
    fireEvent.click(screen.getByText('Relay'));

    expect(screen.queryByRole('button', { name: /Open ServiceNow/i })).not.toBeInTheDocument();
  });

  it('does not show Open ServiceNow button when no snow URL is configured', () => {
    render(<ConnectionBar />);
    fireEvent.click(screen.getByText('Relay'));

    expect(screen.queryByRole('button', { name: /Open ServiceNow/i })).not.toBeInTheDocument();
  });

  it('closes the relay panel when the Relay indicator is clicked a second time', () => {
    render(<ConnectionBar />);

    fireEvent.click(screen.getByText('Relay'));
    expect(screen.getByRole('region', { name: 'Connection details' })).toBeInTheDocument();

    fireEvent.click(screen.getByText('Relay'));
    expect(screen.queryByRole('region', { name: 'Connection details' })).not.toBeInTheDocument();
  });
});
