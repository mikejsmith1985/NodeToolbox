// ConnectionBar.test.tsx — Unit tests for the compact global connection status bar.

import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { useConnectionStore } from '../../store/connectionStore.ts';
import { ConnectionBar } from './ConnectionBar.tsx';
import styles from './ConnectionBar.module.css';

function resetConnectionStore(): void {
  useConnectionStore.setState(useConnectionStore.getInitialState());
}

describe('ConnectionBar', () => {
  beforeEach(() => {
    resetConnectionStore();
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

  it('shows SNow as ready when a live SNow probe has verified the connection', () => {
    useConnectionStore.setState({ isSnowVerified: true });

    render(<ConnectionBar />);

    expect(screen.getByText('SNow')).toHaveClass(styles.ready);
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

  it('closes the relay panel when the Relay indicator is clicked a second time', () => {
    render(<ConnectionBar />);

    fireEvent.click(screen.getByText('Relay'));
    expect(screen.getByRole('region', { name: 'Connection details' })).toBeInTheDocument();

    fireEvent.click(screen.getByText('Relay'));
    expect(screen.queryByRole('region', { name: 'Connection details' })).not.toBeInTheDocument();
  });
});
