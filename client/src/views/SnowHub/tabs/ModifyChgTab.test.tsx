// ModifyChgTab.test.tsx — Tests for the Modify Change tab with "My Open Changes" feature.
// Tests dropdown rendering, selection, loading states, error handling, and empty states.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import ModifyChgTab from './ModifyChgTab.tsx';

// Mock the child tabs and hooks
vi.mock('../hooks/useCtaskTemplates.ts', () => ({
  useCtaskTemplates: () => ({
    templates: [],
    isLoading: false,
    error: null,
  }),
}));

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('ModifyChgTab - My Open Changes Feature', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Load My Open Changes Button ──────────────────────────────────────────

  it('TestMyOpenChanges_RendersLoadMyChangesButton', () => {
    render(<ModifyChgTab />);
    const loadButton = screen.getByRole('button', { name: /Load My Open Changes/i });
    expect(loadButton).toBeInTheDocument();
  });

  it('TestMyOpenChanges_ButtonIsEnabledInitially', () => {
    render(<ModifyChgTab />);
    const loadButton = screen.getByRole('button', { name: /Load My Open Changes/i });
    expect(loadButton).not.toBeDisabled();
  });

  // ── Dropdown Rendering ──────────────────────────────────────────────────

  it('TestMyOpenChanges_DropdownRendersWhenChangesAreLoaded', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { key: 'CHG0001234', summary: 'Update network infrastructure', state: '1', priority: '2', assignedTo: { sysId: 'u1', displayName: 'John' } },
        { key: 'CHG0001235', summary: 'Database migration', state: '2', priority: '3', assignedTo: { sysId: 'u2', displayName: 'Jane' } },
      ],
    });

    render(<ModifyChgTab />);

    const loadButton = screen.getByRole('button', { name: /Load My Open Changes/i });
    await user.click(loadButton);

    await waitFor(() => {
      const dropdown = screen.getByLabelText(/Select from my open changes/i);
      expect(dropdown).toBeInTheDocument();
    });
  });

  it('TestMyOpenChanges_DropdownDisplaysAllChanges', async () => {
    const user = userEvent.setup();
    const mockChanges = [
      { key: 'CHG0001234', summary: 'Update network infrastructure', state: '1', priority: '2', assignedTo: { sysId: '', displayName: '' } },
      { key: 'CHG0001235', summary: 'Database migration', state: '2', priority: '3', assignedTo: { sysId: '', displayName: '' } },
      { key: 'CHG0001236', summary: 'Security patch', state: '3', priority: '1', assignedTo: { sysId: '', displayName: '' } },
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockChanges,
    });

    render(<ModifyChgTab />);

    const loadButton = screen.getByRole('button', { name: /Load My Open Changes/i });
    await user.click(loadButton);

    await waitFor(() => {
      mockChanges.forEach((change) => {
        expect(screen.getByText(`${change.key} - ${change.summary}`)).toBeInTheDocument();
      });
    });
  });

  // ── Error Handling ──────────────────────────────────────────────────────

  it('TestMyOpenChanges_DisplaysErrorWhenFetchFails', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: false,
      statusText: 'Bad Gateway',
    });

    render(<ModifyChgTab />);

    const loadButton = screen.getByRole('button', { name: /Load My Open Changes/i });
    await user.click(loadButton);

    await waitFor(() => {
      expect(screen.getByText(/Failed to fetch my changes/i)).toBeInTheDocument();
    });
  });

  it('TestMyOpenChanges_DisplaysErrorWhenResponseIsInvalid', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ invalid: 'structure' }),
    });

    render(<ModifyChgTab />);

    const loadButton = screen.getByRole('button', { name: /Load My Open Changes/i });
    await user.click(loadButton);

    await waitFor(() => {
      expect(screen.getByText(/Invalid response format/i)).toBeInTheDocument();
    });
  });

  // ── Empty State ─────────────────────────────────────────────────────────

  it('TestMyOpenChanges_DisplaysEmptyMessageWhenNoChangesFound', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    render(<ModifyChgTab />);

    const loadButton = screen.getByRole('button', { name: /Load My Open Changes/i });
    await user.click(loadButton);

    await waitFor(() => {
      expect(screen.getByText(/No open changes found/i)).toBeInTheDocument();
    });
  });

  it('TestMyOpenChanges_HidesDropdownWhenNoChangesFound', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    render(<ModifyChgTab />);

    const loadButton = screen.getByRole('button', { name: /Load My Open Changes/i });
    await user.click(loadButton);

    await waitFor(() => {
      const dropdown = screen.queryByLabelText(/Select from my open changes/i);
      expect(dropdown).not.toBeInTheDocument();
    });
  });

  // ── API Contract ────────────────────────────────────────────────────────

  it('TestMyOpenChanges_CallsFetchWithCorrectEndpoint', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    render(<ModifyChgTab />);

    const loadButton = screen.getByRole('button', { name: /Load My Open Changes/i });
    await user.click(loadButton);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/snow-relay/my-changes');
    });
  });

  // ── Accessibility ──────────────────────────────────────────────────────

  it('TestMyOpenChanges_DropdownHasProperLabel', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { key: 'CHG0001234', summary: 'Update network infrastructure', state: '1', priority: '2', assignedTo: { sysId: '', displayName: '' } },
      ],
    });

    render(<ModifyChgTab />);

    const loadButton = screen.getByRole('button', { name: /Load My Open Changes/i });
    await user.click(loadButton);

    await waitFor(() => {
      const dropdown = screen.getByLabelText(/Select from my open changes/i);
      expect(dropdown).toHaveAttribute('aria-label');
    });
  });
});
