// SharePointPullPanel.test.tsx — Covers the not-configured state, disconnected (Pull blocked),
// connected (Pull fires), status message, and auto-refresh interval behavior.

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import SharePointPullPanel from './SharePointPullPanel.tsx';

const BASE = {
  siteConfigured: true,
  isConnected: true,
  isPulling: false,
  statusMessage: null as string | null,
  onCheckConnection: vi.fn(),
  onPull: vi.fn(),
};

afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });

describe('SharePointPullPanel', () => {
  it('prompts to configure when the site/list are not set', () => {
    render(<SharePointPullPanel {...BASE} siteConfigured={false} />);
    expect(screen.getByText(/add the sharepoint site url and list name/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /pull from sharepoint/i })).not.toBeInTheDocument();
  });

  it('disables Pull and shows the draggable bookmarklet link when not connected', () => {
    render(<SharePointPullPanel {...BASE} isConnected={false} />);
    expect(screen.getByRole('button', { name: /pull from sharepoint/i })).toBeDisabled();
    // The bookmarklet is a draggable link (not raw JSON in an input).
    expect(screen.getByRole('link', { name: /NodeToolbox SharePoint Relay/i })).toBeInTheDocument();
  });

  it('fires onPull when connected and Pull is clicked', () => {
    const onPull = vi.fn();
    render(<SharePointPullPanel {...BASE} onPull={onPull} />);
    fireEvent.click(screen.getByRole('button', { name: /pull from sharepoint/i }));
    expect(onPull).toHaveBeenCalledTimes(1);
  });

  it('shows the status/error message', () => {
    render(<SharePointPullPanel {...BASE} statusMessage="Access denied" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Access denied');
  });

  it('auto-refresh re-pulls on the interval while connected and stops when toggled off', () => {
    vi.useFakeTimers();
    const onPull = vi.fn();
    render(<SharePointPullPanel {...BASE} onPull={onPull} />);

    fireEvent.click(screen.getByLabelText(/auto-refresh/i));
    act(() => { vi.advanceTimersByTime(60000); });
    expect(onPull).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText(/auto-refresh/i)); // off
    act(() => { vi.advanceTimersByTime(120000); });
    expect(onPull).toHaveBeenCalledTimes(1); // no further calls
  });
});
