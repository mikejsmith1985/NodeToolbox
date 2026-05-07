// ConnectionBar.test.tsx — Unit tests for the compact global connection status bar.

import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

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

  it('shows the Jira indicator as ready when the Jira connection is verified', () => {
    useConnectionStore.setState({ isJiraVerified: true });

    render(<ConnectionBar />);

    expect(screen.getByText('Jira')).toHaveClass(styles.ready);
  });

  it('shows the Jira indicator as not ready when the Jira connection is not verified', () => {
    render(<ConnectionBar />);

    expect(screen.getByText('Jira')).toHaveClass(styles.notReady);
  });
});
