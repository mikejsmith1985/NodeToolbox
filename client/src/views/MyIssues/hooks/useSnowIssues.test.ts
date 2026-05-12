// useSnowIssues.test.ts — Unit tests for the useSnowIssues hook.

import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSnowIssues } from './useSnowIssues.ts';
import type { SnowMyIssue } from '../../../types/snow.ts';

// ── Mocks ──

vi.mock('../../../services/snowApi.ts', () => ({
  snowFetch: vi.fn(),
}));

vi.mock('../../../store/connectionStore.ts', () => ({
  useConnectionStore: { getState: () => ({ relayBridgeStatus: { isConnected: true } }) },
}));

import { snowFetch } from '../../../services/snowApi.ts';
const mockSnowFetch = snowFetch as ReturnType<typeof vi.fn>;

// ── Test data ──

const MOCK_INCIDENT: SnowMyIssue = {
  sys_id: 'inc-001',
  number: 'INC0001234',
  short_description: 'Printer not working',
  state: 'New',
  priority: '3 - Moderate',
  sys_class_name: 'incident',
  opened_at: '2026-05-01T10:00:00Z',
};

const MOCK_PROBLEM: SnowMyIssue = {
  sys_id: 'prb-001',
  number: 'PRB0000567',
  short_description: 'Recurring network outages',
  state: 'In Progress',
  priority: '2 - High',
  sys_class_name: 'problem',
  opened_at: '2026-05-02T09:00:00Z',
  problem_statement: 'Multiple network failures affecting floor 3. Linked to TBX-99.',
};

// ── Tests ──

describe('useSnowIssues', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts with empty issues and no error', () => {
    const { result } = renderHook(() => useSnowIssues());
    expect(result.current.snowIssues).toEqual([]);
    expect(result.current.isLoadingSnowIssues).toBe(false);
    expect(result.current.snowFetchError).toBeNull();
  });

  it('sets isLoadingSnowIssues to true while fetching', async () => {
    // Never resolves so we can check the loading state mid-flight.
    mockSnowFetch.mockReturnValue(new Promise(() => undefined));

    const { result } = renderHook(() => useSnowIssues());
    act(() => { void result.current.fetchSnowIssues(); });

    expect(result.current.isLoadingSnowIssues).toBe(true);
  });

  it('populates snowIssues after a successful fetch', async () => {
    mockSnowFetch.mockImplementation((path: string) => {
      if (path.includes('/incident')) return Promise.resolve({ result: [MOCK_INCIDENT] });
      if (path.includes('/problem')) return Promise.resolve({ result: [MOCK_PROBLEM] });
      return Promise.resolve({ result: [] });
    });

    const { result } = renderHook(() => useSnowIssues());
    await act(async () => { await result.current.fetchSnowIssues(); });

    expect(result.current.snowIssues).toHaveLength(2);
    expect(result.current.isLoadingSnowIssues).toBe(false);
  });

  it('stamps sys_class_name from the record-type argument, not the API response', async () => {
    // The raw API response may omit sys_class_name; the hook injects it.
    const rawIncident = { ...MOCK_INCIDENT, sys_class_name: undefined };
    mockSnowFetch.mockImplementation((path: string) => {
      if (path.includes('/incident')) return Promise.resolve({ result: [rawIncident] });
      return Promise.resolve({ result: [] });
    });

    const { result } = renderHook(() => useSnowIssues());
    await act(async () => { await result.current.fetchSnowIssues(); });

    expect(result.current.snowIssues[0].sys_class_name).toBe('incident');
  });

  it('sorts results newest-first by opened_at', async () => {
    mockSnowFetch.mockImplementation((path: string) => {
      if (path.includes('/incident')) return Promise.resolve({ result: [MOCK_INCIDENT] });
      if (path.includes('/problem')) return Promise.resolve({ result: [MOCK_PROBLEM] });
      return Promise.resolve({ result: [] });
    });

    const { result } = renderHook(() => useSnowIssues());
    await act(async () => { await result.current.fetchSnowIssues(); });

    // MOCK_PROBLEM opened 2026-05-02, MOCK_INCIDENT 2026-05-01 — problem should be first.
    expect(result.current.snowIssues[0].number).toBe('PRB0000567');
  });

  it('sets snowFetchError when a record type fails but still returns successful results', async () => {
    mockSnowFetch.mockImplementation((path: string) => {
      if (path.includes('/incident')) return Promise.reject(new Error('SNow relay timeout'));
      return Promise.resolve({ result: [] });
    });

    const { result } = renderHook(() => useSnowIssues());
    await act(async () => { await result.current.fetchSnowIssues(); });

    expect(result.current.snowFetchError).toContain('SNow relay timeout');
    expect(result.current.isLoadingSnowIssues).toBe(false);
  });
});
