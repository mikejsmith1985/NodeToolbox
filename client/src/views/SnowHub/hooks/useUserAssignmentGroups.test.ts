// useUserAssignmentGroups.test.ts — Unit tests for ServiceNow user-to-assignment-group reverse lookup state.

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { snowFetch } from '../../../services/snowApi.ts';
import { useUserAssignmentGroups } from './useUserAssignmentGroups.ts';

vi.mock('../../../services/snowApi.ts', () => ({
  snowFetch: vi.fn(),
}));

describe('useUserAssignmentGroups', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('loads and sorts assignment groups for the selected user', async () => {
    vi.mocked(snowFetch).mockResolvedValue({
      result: [
        { sys_id: 'membership-2', group: { value: 'group-2', display_value: 'Zebra Team' } },
        { sys_id: 'membership-1', group: { value: 'group-1', display_value: 'Alpha Team' } },
      ],
    });

    const { result } = renderHook(() => useUserAssignmentGroups());

    await act(async () => {
      await result.current.lookupAssignmentGroupsForUser({ sysId: 'user-001', displayName: 'Jordan User' });
    });

    await waitFor(() => {
      expect(result.current.assignmentGroupMemberships).toEqual([
        { membershipSysId: 'membership-1', groupSysId: 'group-1', groupDisplayName: 'Alpha Team' },
        { membershipSysId: 'membership-2', groupSysId: 'group-2', groupDisplayName: 'Zebra Team' },
      ]);
      expect(result.current.lookupErrorMessage).toBeNull();
      expect(result.current.isLoadingAssignmentGroups).toBe(false);
    });
  });

  it('deduplicates memberships by group sys_id', async () => {
    vi.mocked(snowFetch).mockResolvedValue({
      result: [
        { sys_id: 'membership-old', group: { value: 'group-1', display_value: 'Platform Team' } },
        { sys_id: 'membership-new', group: { value: 'group-1', display_value: 'Platform Team' } },
      ],
    });

    const { result } = renderHook(() => useUserAssignmentGroups());

    await act(async () => {
      await result.current.lookupAssignmentGroupsForUser({ sysId: 'user-001', displayName: 'Jordan User' });
    });

    expect(result.current.assignmentGroupMemberships).toEqual([
      { membershipSysId: 'membership-new', groupSysId: 'group-1', groupDisplayName: 'Platform Team' },
    ]);
  });

  it('continues paging until all memberships are loaded', async () => {
    vi.mocked(snowFetch)
      .mockResolvedValueOnce({
        result: Array.from({ length: 200 }, (_, membershipIndex) => ({
          sys_id: `membership-${membershipIndex}`,
          group: {
            value: `group-${membershipIndex}`,
            display_value: `Group ${membershipIndex}`,
          },
        })),
      })
      .mockResolvedValueOnce({
        result: [
          { sys_id: 'membership-200', group: { value: 'group-200', display_value: 'Group 200' } },
        ],
      });

    const { result } = renderHook(() => useUserAssignmentGroups());

    await act(async () => {
      await result.current.lookupAssignmentGroupsForUser({ sysId: 'user-001', displayName: 'Jordan User' });
    });

    expect(snowFetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(snowFetch).mock.calls[0]?.[0]).toContain('sysparm_offset=0');
    expect(vi.mocked(snowFetch).mock.calls[1]?.[0]).toContain('sysparm_offset=200');
    expect(result.current.assignmentGroupMemberships).toHaveLength(201);
  });

  it('returns a validation message when no user sys_id is provided', async () => {
    const { result } = renderHook(() => useUserAssignmentGroups());

    await act(async () => {
      await result.current.lookupAssignmentGroupsForUser({ sysId: '', displayName: 'Jordan User' });
    });

    expect(result.current.lookupErrorMessage).toBe('Select a user before running assignment-group lookup.');
    expect(result.current.assignmentGroupMemberships).toEqual([]);
    expect(snowFetch).not.toHaveBeenCalled();
  });

  it('surfaces the lookup failure message when ServiceNow request fails', async () => {
    vi.mocked(snowFetch).mockRejectedValue(new Error('SNow relay not connected'));

    const { result } = renderHook(() => useUserAssignmentGroups());

    await act(async () => {
      await result.current.lookupAssignmentGroupsForUser({ sysId: 'user-001', displayName: 'Jordan User' });
    });

    expect(result.current.lookupErrorMessage).toBe('SNow relay not connected');
    expect(result.current.assignmentGroupMemberships).toEqual([]);
  });

  it('clears both groups and errors', async () => {
    vi.mocked(snowFetch).mockRejectedValue(new Error('SNow relay not connected'));
    const { result } = renderHook(() => useUserAssignmentGroups());

    await act(async () => {
      await result.current.lookupAssignmentGroupsForUser({ sysId: 'user-001', displayName: 'Jordan User' });
    });

    act(() => {
      result.current.clearAssignmentGroupResults();
    });

    expect(result.current.lookupErrorMessage).toBeNull();
    expect(result.current.assignmentGroupMemberships).toEqual([]);
  });
});
