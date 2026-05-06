// App.test.tsx — Unit tests for the Phase 0 foundation App component.
//
// Verifies that the React root mounts without errors and that the proxy status
// fetch is correctly wired to the Express backend. These tests grow in Phase 1+
// as the full layout shell and routes are added.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App.tsx';

// ── Fetch mock ────────────────────────────────────────────────────────────────

const MOCK_PROXY_STATUS_RESPONSE = {
  version: '0.3.5',
  jiraConfigured: true,
  snowConfigured: false,
};

beforeEach(() => {
  // Replace global fetch so tests never hit the real network.
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => MOCK_PROXY_STATUS_RESPONSE,
  }));
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('App — Phase 0 foundation', () => {
  it('renders the foundation heading', async () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByText(/NodeToolbox React SPA/i)).toBeInTheDocument();

    // Drain the async fetch so React state updates are flushed before cleanup
    await waitFor(() => {
      expect(screen.queryByText(/Connecting to/i)).not.toBeInTheDocument();
    });
  });

  it('calls /api/proxy-status on mount', async () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/proxy-status');

    // Drain the async fetch so React state updates are flushed before cleanup
    await waitFor(() => {
      expect(screen.queryByText(/Connecting to/i)).not.toBeInTheDocument();
    });
  });

  it('displays the backend version once the fetch resolves', async () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    // Wait for the async fetch to resolve and the component to re-render
    await waitFor(() => {
      expect(screen.getByText(/v0\.3\.5/)).toBeInTheDocument();
    });
  });

  it('shows an error message when the backend is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/Could not reach backend/i)).toBeInTheDocument();
    });
  });
});
