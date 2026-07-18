// useReadinessData.test.ts — Proves the readiness data hook fetches each lens scope and feeds them
// all through the single scan, exposing one ReadinessScanResult.

import { renderHook, waitFor, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockLoadFieldConfig, mockFetch } = vi.hoisted(() => ({
  mockLoadFieldConfig: vi.fn(),
  mockFetch: vi.fn(),
}));

vi.mock('../../Hygiene/checks/hygieneFieldConfig.ts', () => ({ loadHygieneFieldConfig: mockLoadFieldConfig }));
vi.mock('./readinessFeatureQuery.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./readinessFeatureQuery.ts')>()),
  fetchReadinessFeatures: mockFetch,
}));

import { useReadinessData } from './useReadinessData.ts';
import { resolveHygieneFieldConfig } from '../../Hygiene/checks/hygieneChecks.ts';

function buildFeature(key: string) {
  return {
    key,
    fields: {
      summary: key,
      status: { name: 'Analyzing', statusCategory: { key: 'new' } },
      assignee: null,
      issuetype: { name: 'Feature', iconUrl: '' },
      created: '2026-01-01T00:00:00.000Z',
      updated: '2026-07-01T00:00:00.000Z',
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  mockLoadFieldConfig.mockResolvedValue(resolveHygieneFieldConfig({ productOwnerFieldIds: ['customfield_20002'] }));
  // Current, upcoming, carryover queries each return one feature.
  mockFetch.mockResolvedValue({ issues: [buildFeature('F-1')], isTruncated: false });
});

describe('useReadinessData', () => {
  it('produces a scan result summing the fetched lenses', async () => {
    const { result } = renderHook(() => useReadinessData({
      selectedPiName: 'PI 26.3',
      availablePiNames: ['PI 26.4', 'PI 26.3', 'PI 26.2'],
      rosterTeams: [{ jiraLabel: 'team-a' }],
    }));

    await waitFor(() => expect(result.current.scanResult).not.toBeNull());
    // Three scope queries ran (current, upcoming, carryover).
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(result.current.scanResult?.scannedFeatureCount).toBeGreaterThan(0);
  });

  it('produces no scan result while no PI is selected', () => {
    const { result } = renderHook(() => useReadinessData({
      selectedPiName: '',
      availablePiNames: [],
      rosterTeams: [],
    }));

    expect(result.current.scanResult).toBeNull();
  });

  it('re-fetches when reload is called', async () => {
    const { result } = renderHook(() => useReadinessData({
      selectedPiName: 'PI 26.3',
      availablePiNames: ['PI 26.4', 'PI 26.3'],
      rosterTeams: [],
    }));

    await waitFor(() => expect(result.current.scanResult).not.toBeNull());
    const callsAfterMount = mockFetch.mock.calls.length;

    act(() => { result.current.reload(); });

    await waitFor(() => expect(mockFetch.mock.calls.length).toBeGreaterThan(callsAfterMount));
  });

  it('surfaces a load error as a null scanned count when a fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('Jira 500'));
    const { result } = renderHook(() => useReadinessData({
      selectedPiName: 'PI 26.3',
      availablePiNames: ['PI 26.4', 'PI 26.3'],
      rosterTeams: [],
    }));

    await waitFor(() => expect(result.current.scanResult).not.toBeNull());
    expect(result.current.scanResult?.loadError).toBe('Jira 500');
    expect(result.current.scanResult?.scannedFeatureCount).toBeNull();
  });
});
