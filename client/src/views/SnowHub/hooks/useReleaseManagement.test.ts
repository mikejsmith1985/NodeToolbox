// useReleaseManagement.test.ts — Unit tests for the Release Management state hook.

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { snowFetch } from '../../../services/snowApi.ts';
import { useConnectionStore } from '../../../store/connectionStore.ts';
import { useReleaseManagement } from './useReleaseManagement.ts';

vi.mock('../../../services/snowApi.ts', () => ({
  snowFetch: vi.fn(),
}));

const MOCK_CHANGE_RECORD = {
  sys_id: { value: 'change-1', display_value: 'change-1' },
  number: { value: 'CHG0012345', display_value: 'CHG0012345' },
  short_description: { value: 'Deploy checkout service fixes', display_value: 'Deploy checkout service fixes' },
  state: { value: '-2', display_value: 'Scheduled' },
  assigned_to: { value: 'user-1', display_value: 'Casey Engineer' },
  planned_start_date: { value: '2025-02-01 08:00:00', display_value: '2025-02-01 08:00:00' },
  planned_end_date: { value: '2025-02-01 09:00:00', display_value: '2025-02-01 09:00:00' },
  risk: { value: 'moderate', display_value: 'Moderate' },
  impact: { value: 'medium', display_value: 'Medium' },
};

const EXPECTED_CHANGE_REQUEST = {
  sysId: 'change-1',
  number: 'CHG0012345',
  shortDescription: 'Deploy checkout service fixes',
  state: 'Scheduled',
  assignedTo: { sysId: 'user-1', name: 'Casey Engineer', email: '' },
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
    vi.mocked(snowFetch).mockResolvedValue({ result: [MOCK_CHANGE_RECORD] });
    const { result } = renderHook(() => useReleaseManagement());

    act(() => {
      result.current.actions.setChgNumber('chg0012345');
    });

    await act(async () => {
      await result.current.actions.loadChg();
    });

    await waitFor(() => {
      expect(result.current.state.loadedChg).toEqual(EXPECTED_CHANGE_REQUEST);
      expect(result.current.state.loadError).toBeNull();
    });
    expect(vi.mocked(snowFetch)).toHaveBeenCalledWith(
      expect.stringContaining('/api/now/table/change_request?'),
      { forceDirectProxy: true },
    );
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
    vi.mocked(snowFetch).mockResolvedValue({ result: [MOCK_CHANGE_RECORD] });

    const { result } = renderHook(() => useReleaseManagement());

    await act(async () => {
      await result.current.actions.loadMyActiveChanges();
    });

    expect(snowFetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(snowFetch).mock.calls[0]).toEqual([
      expect.stringContaining('sysparm_query=assigned_to%3Djavascript%3Ags.getUserID()%5Eactive%3Dtrue'),
      { forceDirectProxy: true },
    ]);
    expect(vi.mocked(snowFetch).mock.calls[0][0]).toContain(
      'sysparm_query=assigned_to%3Djavascript%3Ags.getUserID()%5Eactive%3Dtrue',
    );
    expect(vi.mocked(snowFetch).mock.calls[0][0]).toContain('sysparm_display_value=all');
    expect(result.current.state.myChangesError).toBeNull();
    expect(result.current.state.myActiveChanges).toEqual([EXPECTED_CHANGE_REQUEST]);
  });
});
