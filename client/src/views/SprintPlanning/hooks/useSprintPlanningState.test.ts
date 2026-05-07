// useSprintPlanningState.test.ts — Hook unit tests for Sprint Planning state.

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clampStoryPointsInput,
  detectStoryPointsField,
  issueTypeToEmoji,
  priorityToColorHex,
  useSprintPlanningState,
} from './useSprintPlanningState.ts';

vi.mock('../../../services/jiraApi.ts', () => ({
  jiraGet: vi.fn(),
  jiraPut: vi.fn(),
}));

import { jiraGet, jiraPut } from '../../../services/jiraApi.ts';

const mockJiraGet = vi.mocked(jiraGet);
const mockJiraPut = vi.mocked(jiraPut);

const SAMPLE_BACKLOG_RESPONSE = {
  issues: [
    {
      key: 'TBX-1',
      fields: {
        summary: 'First story',
        priority: { name: 'High' },
        issuetype: { name: 'Story' },
        assignee: { displayName: 'Alex' },
        customfield_10016: 3,
      },
    },
    {
      key: 'TBX-2',
      fields: {
        summary: 'Second story',
        priority: { name: 'Medium' },
        issuetype: { name: 'Bug' },
        assignee: null,
        customfield_10016: null,
      },
    },
  ],
};

beforeEach(() => {
  mockJiraGet.mockReset();
  mockJiraPut.mockReset();
});

describe('helpers', () => {
  it('priorityToColorHex returns colour tokens by priority name', () => {
    expect(priorityToColorHex('Highest')).toBe('#e11d48');
    expect(priorityToColorHex('High')).toBe('#f97316');
    expect(priorityToColorHex('Medium')).toBe('#f59e0b');
    expect(priorityToColorHex('Low')).toBe('#22c55e');
    expect(priorityToColorHex('Lowest')).toBe('#6b7280');
    expect(priorityToColorHex('Unknown')).toBe('#6b7280');
  });

  it('issueTypeToEmoji maps known issue types to icons and falls back to a generic doc', () => {
    expect(issueTypeToEmoji('Story')).toBe('📗');
    expect(issueTypeToEmoji('Bug')).toBe('🐛');
    expect(issueTypeToEmoji('Task')).toBe('✅');
    expect(issueTypeToEmoji('Epic')).toBe('⚡');
    expect(issueTypeToEmoji('Sub-task')).toBe('🔹');
    expect(issueTypeToEmoji('Whatever')).toBe('📄');
  });

  it('clampStoryPointsInput rounds invalid input to 0 and clamps to 100', () => {
    expect(clampStoryPointsInput('abc')).toBe(0);
    expect(clampStoryPointsInput('-5')).toBe(0);
    expect(clampStoryPointsInput('5')).toBe(5);
    expect(clampStoryPointsInput('5.7')).toBe(6);
    expect(clampStoryPointsInput('999')).toBe(100);
  });

  it('detectStoryPointsField prefers the modern field when at least one issue uses it uniquely', () => {
    const rawIssues = [
      { key: 'TBX-A', fields: { customfield_10028: 5 } },
      { key: 'TBX-B', fields: { customfield_10016: 3 } },
    ] as never;
    expect(detectStoryPointsField([], rawIssues)).toBe('customfield_10028');
  });

  it('detectStoryPointsField falls back to the legacy field when no issue uses the modern one alone', () => {
    const rawIssues = [
      { key: 'TBX-A', fields: { customfield_10016: 3 } },
      { key: 'TBX-B', fields: { customfield_10016: 8 } },
    ] as never;
    expect(detectStoryPointsField([], rawIssues)).toBe('customfield_10016');
  });
});

describe('useSprintPlanningState', () => {
  it('starts empty with no pending changes', () => {
    const { result } = renderHook(() => useSprintPlanningState());

    expect(result.current.backlog).toEqual([]);
    expect(result.current.pendingChanges).toEqual({});
    expect(result.current.isLoading).toBe(false);
    expect(result.current.loadError).toBeNull();
  });

  it('loads the backlog from Jira and maps each row', async () => {
    mockJiraGet.mockResolvedValue(SAMPLE_BACKLOG_RESPONSE);
    const { result } = renderHook(() => useSprintPlanningState());

    act(() => {
      result.current.setProjectKey('TBX');
    });
    await act(async () => {
      await result.current.loadBacklog();
    });

    expect(mockJiraGet).toHaveBeenCalledWith(expect.stringContaining('jql=project'));
    expect(result.current.backlog).toHaveLength(2);
    expect(result.current.backlog[0]).toMatchObject({
      key: 'TBX-1',
      summary: 'First story',
      issueType: 'Story',
      priority: 'High',
      assignee: 'Alex',
      storyPoints: 3,
    });
    expect(result.current.backlog[1].assignee).toBe('');
  });

  it('captures load errors with a friendly message', async () => {
    mockJiraGet.mockRejectedValue(new Error('Jira down'));
    const { result } = renderHook(() => useSprintPlanningState());

    await act(async () => {
      await result.current.loadBacklog();
    });

    await waitFor(() => expect(result.current.loadError).toBe('Jira down'));
    expect(result.current.backlog).toEqual([]);
  });

  it('records pending changes and clamps invalid values', () => {
    const { result } = renderHook(() => useSprintPlanningState());

    act(() => result.current.setStoryPoints('TBX-1', '8'));
    act(() => result.current.setStoryPoints('TBX-2', '-2'));
    act(() => result.current.setStoryPoints('TBX-3', '999'));

    expect(result.current.pendingChanges).toEqual({ 'TBX-1': 8, 'TBX-2': 0, 'TBX-3': 100 });
  });

  it('saves changes via PUT and clears them on success', async () => {
    mockJiraGet.mockResolvedValue(SAMPLE_BACKLOG_RESPONSE);
    mockJiraPut.mockResolvedValue(undefined);

    const { result } = renderHook(() => useSprintPlanningState());

    await act(async () => {
      await result.current.loadBacklog();
    });
    act(() => result.current.setStoryPoints('TBX-1', '5'));
    await act(async () => {
      await result.current.saveChanges();
    });

    expect(mockJiraPut).toHaveBeenCalledWith(
      '/rest/api/2/issue/TBX-1',
      expect.objectContaining({ fields: expect.any(Object) }),
    );
    expect(result.current.pendingChanges).toEqual({});
    expect(result.current.saveStatusMessage).toBe('✅ All changes saved');
    const updatedIssue = result.current.backlog.find((row) => row.key === 'TBX-1');
    expect(updatedIssue?.storyPoints).toBe(5);
  });

  it('reports failed keys when some saves error out', async () => {
    mockJiraGet.mockResolvedValue(SAMPLE_BACKLOG_RESPONSE);
    mockJiraPut
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('forbidden'));

    const { result } = renderHook(() => useSprintPlanningState());

    await act(async () => {
      await result.current.loadBacklog();
    });
    act(() => result.current.setStoryPoints('TBX-1', '5'));
    act(() => result.current.setStoryPoints('TBX-2', '8'));
    await act(async () => {
      await result.current.saveChanges();
    });

    expect(result.current.failedSaveKeys.length).toBe(1);
    expect(result.current.saveStatusMessage).toMatch(/Saved 1, failed: TBX-/);
    expect(Object.keys(result.current.pendingChanges)).toEqual(result.current.failedSaveKeys);
  });

  it('resetPendingChanges drops all queued edits', () => {
    const { result } = renderHook(() => useSprintPlanningState());

    act(() => result.current.setStoryPoints('TBX-1', '5'));
    act(() => result.current.resetPendingChanges());

    expect(result.current.pendingChanges).toEqual({});
    expect(result.current.saveStatusMessage).toBeNull();
  });
});
