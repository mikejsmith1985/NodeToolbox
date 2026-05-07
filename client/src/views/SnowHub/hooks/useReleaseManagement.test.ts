// useReleaseManagement.test.ts — Unit tests for the Release Management state hook.

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { snowFetch } from '../../../services/snowApi.ts';
import { useConnectionStore } from '../../../store/connectionStore.ts';
import { useReleaseManagement } from './useReleaseManagement.ts';

vi.mock('../../../services/snowApi.ts', () => ({
  snowFetch: vi.fn(),
}));

const MOCK_CHANGE_REQUEST = {
  sysId: 'change-1',
  number: 'CHG0012345',
  shortDescription: 'Deploy checkout service fixes',
  state: 'Scheduled',
  assignedTo: null,
  plannedStartDate: '2025-02-01 08:00:00',
  plannedEndDate: '2025-02-01 09:00:00',
  risk: 'Moderate',
  impact: 'Medium',
};

describe('useReleaseManagement', () => {
  beforeEach(() => {
    useConnectionStore.setState(useConnectionStore.getInitialState());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('starts with an empty release-management state', () => {
    const { result } = renderHook(() => useReleaseManagement());

    expect(result.current.state.chgNumber).toBe('');
    expect(result.current.state.loadedChg).toBeNull();
    expect(result.current.state.activityLog).toEqual([]);
  });

  it('updates the change number when setChgNumber is called', () => {
    const { result } = renderHook(() => useReleaseManagement());

    act(() => {
      result.current.actions.setChgNumber('chg0012345');
    });

    expect(result.current.state.chgNumber).toBe('CHG0012345');
  });

  it('stores the loaded change request after a successful fetch', async () => {
    vi.mocked(snowFetch).mockResolvedValue(MOCK_CHANGE_REQUEST);
    const { result } = renderHook(() => useReleaseManagement());

    act(() => {
      result.current.actions.setChgNumber('chg0012345');
    });

    await act(async () => {
      await result.current.actions.loadChg();
    });

    await waitFor(() => {
      expect(result.current.state.loadedChg).toEqual(MOCK_CHANGE_REQUEST);
      expect(result.current.state.loadError).toBeNull();
    });
  });

  it('stores a load error when loading a change request fails', async () => {
    vi.mocked(snowFetch).mockRejectedValue(new Error('SNow unavailable'));
    const { result } = renderHook(() => useReleaseManagement());

    act(() => {
      result.current.actions.setChgNumber('chg0012345');
    });

    await act(async () => {
      await result.current.actions.loadChg();
    });

    await waitFor(() => {
      expect(result.current.state.loadError).toBe('SNow unavailable');
    });
  });

  it('clears the activity log when clearLog is called', () => {
    const { result } = renderHook(() => useReleaseManagement());

    act(() => {
      result.current.actions.appendLogEntry('Loaded change CHG0012345.', 'success');
    });

    expect(result.current.state.activityLog).toHaveLength(1);

    act(() => {
      result.current.actions.clearLog();
    });

    expect(result.current.state.activityLog).toEqual([]);
  });

  it('does not call snowFetch when SNow is not ready and sets an actionable error', async () => {
    // SNow is not configured — isSnowReady stays false (default store state)
    const { result } = renderHook(() => useReleaseManagement());

    await act(async () => {
      await result.current.actions.loadMyActiveChanges();
    });

    expect(snowFetch).not.toHaveBeenCalled();
    expect(result.current.state.myChangesError).toContain('SNow is not configured');
  });

  it('calls snowFetch when SNow is ready', async () => {
    useConnectionStore.setState({ isSnowReady: true });
    vi.mocked(snowFetch).mockResolvedValue({ result: [] });

    const { result } = renderHook(() => useReleaseManagement());

    await act(async () => {
      await result.current.actions.loadMyActiveChanges();
    });

    expect(snowFetch).toHaveBeenCalledTimes(1);
    expect(result.current.state.myChangesError).toBeNull();
  });
});
