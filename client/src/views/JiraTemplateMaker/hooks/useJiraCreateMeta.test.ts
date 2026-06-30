// useJiraCreateMeta.test.ts — Unit tests for the modern createmeta loading hook.

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getIssueTypeFields, getProjectIssueTypes } from '../../../services/jiraApi.ts';
import { useJiraCreateMeta } from './useJiraCreateMeta.ts';

vi.mock('../../../services/jiraApi.ts', () => ({
  getProjectIssueTypes: vi.fn(),
  getIssueTypeFields: vi.fn(),
}));
const issueTypesMock = vi.mocked(getProjectIssueTypes);
const fieldsMock = vi.mocked(getIssueTypeFields);

afterEach(() => { vi.clearAllMocks(); });

describe('useJiraCreateMeta', () => {
  it('loads the project issue types eagerly', async () => {
    issueTypesMock.mockResolvedValue({ values: [{ id: '1', name: 'Task', subtask: false }] } as never);
    const { result } = renderHook(() => useJiraCreateMeta('ABC'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.issueTypes.map((it) => it.name)).toEqual(['Task']);
    expect(result.current.hasCreatePermission).toBe(true);
  });

  it('loads and caches field descriptors for an issue type on demand', async () => {
    issueTypesMock.mockResolvedValue({ values: [{ id: '1', name: 'Task', subtask: false }] } as never);
    fieldsMock.mockResolvedValue({ values: [
      { fieldId: 'priority', required: false, name: 'Priority', schema: { type: 'priority' }, allowedValues: [{ id: '2', name: 'High' }] },
    ] } as never);
    const { result } = renderHook(() => useJiraCreateMeta('ABC'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => { result.current.loadFields('1'); });
    await waitFor(() => expect(result.current.getFieldDescriptors('1')).toHaveLength(1));
    expect(result.current.getFieldDescriptors('1')[0].allowedValues).toEqual([{ id: '2', label: 'High' }]);

    // Second call uses the cache (no extra fetch).
    act(() => { result.current.loadFields('1'); });
    expect(fieldsMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces a no-permission message when there are no issue types', async () => {
    issueTypesMock.mockResolvedValue({ values: [] } as never);
    const { result } = renderHook(() => useJiraCreateMeta('ABC'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasCreatePermission).toBe(false);
    expect(result.current.errorMessage).toMatch(/create permission/i);
  });

  it('surfaces the underlying error and no data when the request fails', async () => {
    issueTypesMock.mockRejectedValue(new Error('Jira GET ... failed: 410'));
    const { result } = renderHook(() => useJiraCreateMeta('ABC'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.issueTypes).toEqual([]);
    expect(result.current.errorMessage).toMatch(/410/);
  });

  it('stays idle with no project selected', () => {
    const { result } = renderHook(() => useJiraCreateMeta(null));
    expect(result.current.isLoading).toBe(false);
    expect(issueTypesMock).not.toHaveBeenCalled();
  });
});
