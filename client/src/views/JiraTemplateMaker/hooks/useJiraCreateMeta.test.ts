// useJiraCreateMeta.test.ts — Unit tests for the createmeta loading hook.

import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getCreateMeta } from '../../../services/jiraApi.ts';
import { useJiraCreateMeta } from './useJiraCreateMeta.ts';

vi.mock('../../../services/jiraApi.ts', () => ({ getCreateMeta: vi.fn() }));
const getCreateMetaMock = vi.mocked(getCreateMeta);

const SAMPLE_META = {
  projects: [{
    id: '10000', key: 'ABC', name: 'Alpha',
    issuetypes: [{
      id: '1', name: 'Task', subtask: false,
      fields: {
        summary: { required: true, name: 'Summary', schema: { type: 'string', system: 'summary' } },
        priority: { required: false, name: 'Priority', schema: { type: 'priority', system: 'priority' }, allowedValues: [{ id: '2', name: 'High' }] },
      },
    }],
  }],
};

describe('useJiraCreateMeta', () => {
  afterEach(() => { vi.clearAllMocks(); });

  it('loads issue types and maps field descriptors for the project', async () => {
    getCreateMetaMock.mockResolvedValue(SAMPLE_META as never);
    const { result } = renderHook(() => useJiraCreateMeta('ABC'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.issueTypes.map((it) => it.name)).toEqual(['Task']);
    expect(result.current.hasCreatePermission).toBe(true);

    const descriptors = result.current.getFieldDescriptors('1');
    expect(descriptors.find((d) => d.fieldId === 'priority')?.allowedValues).toEqual([{ id: '2', label: 'High' }]);
    // Required field sorts first.
    expect(descriptors[0].fieldId).toBe('summary');
  });

  it('surfaces a no-permission message when the project has no issue types', async () => {
    getCreateMetaMock.mockResolvedValue({ projects: [{ id: '1', key: 'ABC', name: 'Alpha', issuetypes: [] }] } as never);
    const { result } = renderHook(() => useJiraCreateMeta('ABC'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasCreatePermission).toBe(false);
    expect(result.current.errorMessage).toMatch(/permission/i);
  });

  it('surfaces a load error and presents no data on failure', async () => {
    getCreateMetaMock.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useJiraCreateMeta('ABC'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.project).toBeNull();
    expect(result.current.errorMessage).toMatch(/could not load/i);
  });

  it('stays idle with no project selected', () => {
    const { result } = renderHook(() => useJiraCreateMeta(null));
    expect(result.current.isLoading).toBe(false);
    expect(getCreateMetaMock).not.toHaveBeenCalled();
  });
});
