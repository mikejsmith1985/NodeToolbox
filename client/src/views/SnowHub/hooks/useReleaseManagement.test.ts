// useReleaseManagement.test.ts — Unit tests for the Release Management state hook.

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { snowFetch } from '../../../services/snowApi.ts';
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
  start_date: { value: '2025-02-01 08:00:00', display_value: '2025-02-01 08:00:00' },
  end_date: { value: '2025-02-01 09:00:00', display_value: '2025-02-01 09:00:00' },
  risk: { value: 'moderate', display_value: 'Moderate' },
  impact: { value: 'medium', display_value: 'Medium' },
};

const MOCK_CHANGE_RECORD_WITH_BLANK_DATE_DISPLAY = {
  ...MOCK_CHANGE_RECORD,
  start_date: { value: '2025-02-01 08:00:00', display_value: '' },
  end_date: { value: '2025-02-01 09:00:00', display_value: '' },
};

const EXPECTED_CHANGE_REQUEST = {
  sysId: 'change-1',
  number: 'CHG0012345',
  shortDescription: 'Deploy checkout service fixes',
  state: 'Scheduled',
  stateValue: '-2',
  assignedTo: { sysId: 'user-1', name: 'Casey Engineer', email: '' },
  plannedStartDate: '2025-02-01 08:00:00',
  plannedEndDate: '2025-02-01 09:00:00',
  risk: 'Moderate',
  impact: 'Medium',
};

const EXPECTED_ACTIVE_CHANGE_SUMMARY = {
  sysId: 'change-1',
  number: 'CHG0012345',
  shortDescription: 'Deploy checkout service fixes',
  state: 'Scheduled',
  stateValue: '-2',
  plannedStartDate: '2025-02-01 08:00:00',
  plannedEndDate: '2025-02-01 09:00:00',
  alertSeverity: 'error',
  alertMessage: 'Planned end has passed and this change is not in a completed state.',
};

describe('useReleaseManagement', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('starts with an empty release-management state', () => {
    const { result } = renderHook(() => useReleaseManagement());

    expect(result.current.state.chgNumber).toBe('');
    expect(result.current.state.loadedChg).toBeNull();
    expect(result.current.state.activityLog).toEqual([]);
    expect(result.current.state.monitorSettings.shouldAlertOnPlannedStartMiss).toBe(true);
    expect(result.current.state.monitorSettings.shouldAlertOnPlannedEndMiss).toBe(true);
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
    expect(vi.mocked(snowFetch)).toHaveBeenCalledWith(expect.stringContaining('/api/now/table/change_request?'));
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

  it('stores the relay guidance when loading active changes fails before ServiceNow is connected', async () => {
    vi.mocked(snowFetch).mockRejectedValue(
      new Error('SNow relay not connected. Click Relay -> Open ServiceNow, then click the NodeToolbox SNow Relay bookmarklet.'),
    );
    const { result } = renderHook(() => useReleaseManagement());

    await act(async () => {
      await result.current.actions.loadMyActiveChanges();
    });

    expect(snowFetch).toHaveBeenCalledTimes(1);
    expect(result.current.state.myChangesError).toContain('SNow relay not connected');
  });

  it('uses the relay-backed snowFetch path when loading active changes', async () => {
    vi.mocked(snowFetch).mockResolvedValue({ result: [MOCK_CHANGE_RECORD] });

    const { result } = renderHook(() => useReleaseManagement());

    await act(async () => {
      await result.current.actions.loadMyActiveChanges();
    });

    expect(snowFetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(snowFetch).mock.calls[0][0]).toContain(
      'sysparm_query=assigned_to%3Djavascript%3Ags.getUserID()%5Eactive%3Dtrue',
    );
    expect(vi.mocked(snowFetch).mock.calls[0][0]).toContain('sysparm_fields=sys_id,number,short_description,state,start_date,end_date');
    expect(vi.mocked(snowFetch).mock.calls[0][0]).toContain('sysparm_display_value=all');
    expect(result.current.state.myChangesError).toBeNull();
    expect(result.current.state.myActiveChanges).toEqual([EXPECTED_ACTIVE_CHANGE_SUMMARY]);
    expect(result.current.state.activityLog.some((entry) => entry.message.includes('End milestone missed'))).toBe(true);
  });

  it('falls back to date value when ServiceNow date display_value is blank', async () => {
    vi.mocked(snowFetch).mockResolvedValue({ result: [MOCK_CHANGE_RECORD_WITH_BLANK_DATE_DISPLAY] });
    const { result } = renderHook(() => useReleaseManagement());

    await act(async () => {
      await result.current.actions.loadMyActiveChanges();
    });

    expect(result.current.state.myActiveChanges[0]?.plannedStartDate).toBe('2025-02-01 08:00:00');
    expect(result.current.state.myActiveChanges[0]?.plannedEndDate).toBe('2025-02-01 09:00:00');
  });

  it('updates monitor settings when setMonitorSetting is called', () => {
    const { result } = renderHook(() => useReleaseManagement());

    act(() => {
      result.current.actions.setMonitorSetting('shouldAlertOnPlannedStartMiss', false);
    });

    expect(result.current.state.monitorSettings.shouldAlertOnPlannedStartMiss).toBe(false);
  });
});
