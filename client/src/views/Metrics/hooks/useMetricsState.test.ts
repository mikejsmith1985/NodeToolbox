// useMetricsState.test.ts — Hook coverage for Metrics persistence and Jira loading.

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useMetricsState } from './useMetricsState.ts';

vi.mock('../../../services/jiraApi.ts', () => ({
  jiraGet: vi.fn(),
}));

import { jiraGet } from '../../../services/jiraApi.ts';

const mockJiraGet = vi.mocked(jiraGet);
const METRICS_CONFIG_STORAGE_KEY = 'tbxMetricsConfig';
const BOARD_RESPONSE_SCRUM = { type: 'scrum' };
const BOARD_RESPONSE_KANBAN = { type: 'kanban' };
const CLOSED_SPRINTS_RESPONSE = {
  values: [
    { id: 1, name: 'Sprint 1', startDate: '2024-01-01T00:00:00.000Z' },
    { id: 2, name: 'Sprint 2', startDate: '2024-01-15T00:00:00.000Z' },
  ],
};
const SPRINT_REPORT_RESPONSE = {
  contents: {
    completedIssues: [
      { key: 'TBX-1', currentEstimateStatistic: { statFieldValue: { value: 5 } } },
      { key: 'TBX-2', currentEstimateStatistic: { statFieldValue: { value: 3 } } },
    ],
    incompletedIssues: [{ key: 'TBX-3', currentEstimateStatistic: { statFieldValue: { value: 2 } } }],
    puntedIssues: [],
    issueKeysAddedDuringSprint: { 'TBX-2': true },
  },
};
const CYCLE_TIME_RESPONSE = {
  issues: [
    {
      fields: {
        created: '2024-01-01T00:00:00.000Z',
        resolutiondate: '2024-01-04T00:00:00.000Z',
        updated: '2024-01-05T00:00:00.000Z',
      },
    },
    {
      fields: {
        created: '2024-01-01T00:00:00.000Z',
        resolutiondate: null,
        updated: '2024-01-03T00:00:00.000Z',
      },
    },
  ],
};

beforeEach(() => {
  mockJiraGet.mockReset();
  window.localStorage.clear();
});

describe('useMetricsState persistence', () => {
  it('restores config from localStorage', () => {
    window.localStorage.setItem(
      METRICS_CONFIG_STORAGE_KEY,
      JSON.stringify({ boardId: '77', projectKey: 'TBX', sprintWindow: 4 }),
    );

    const hookRender = renderHook(() => useMetricsState());

    expect(hookRender.result.current.boardId).toBe('77');
    expect(hookRender.result.current.projectKey).toBe('TBX');
    expect(hookRender.result.current.sprintWindow).toBe(4);
  });

  it('persists edited config values to localStorage', async () => {
    const hookRender = renderHook(() => useMetricsState());

    act(() => hookRender.result.current.setBoardId('88'));
    act(() => hookRender.result.current.setProjectKey('abc'));
    act(() => hookRender.result.current.setSprintWindow(9));

    await waitFor(() => {
      expect(window.localStorage.getItem(METRICS_CONFIG_STORAGE_KEY)).toBe(
        JSON.stringify({ boardId: '88', projectKey: 'abc', sprintWindow: 9 }),
      );
    });
  });
});

describe('useMetricsState Jira loading', () => {
  it('detects a scrum board and loads closed sprint reports', async () => {
    mockJiraGet
      .mockResolvedValueOnce(BOARD_RESPONSE_SCRUM)
      .mockResolvedValueOnce(CLOSED_SPRINTS_RESPONSE)
      .mockResolvedValueOnce(SPRINT_REPORT_RESPONSE)
      .mockResolvedValueOnce(SPRINT_REPORT_RESPONSE);
    const hookRender = renderHook(() => useMetricsState());

    act(() => hookRender.result.current.setBoardId('42'));
    await act(async () => {
      await hookRender.result.current.reload();
    });

    expect(mockJiraGet).toHaveBeenCalledWith('/rest/agile/1.0/board/42');
    expect(mockJiraGet).toHaveBeenCalledWith('/rest/agile/1.0/board/42/sprint?state=closed&maxResults=6&orderBy=startDate');
    expect(hookRender.result.current.boardType).toBe('scrum');
    expect(hookRender.result.current.predictability).toHaveLength(2);
    expect(hookRender.result.current.averageCompletionPct).toBe(71);
    expect(hookRender.result.current.throughput[0]).toMatchObject({ completedIssues: 2, completedPoints: 8 });
  });

  it('detects a kanban board and skips sprint commitment metrics', async () => {
    mockJiraGet.mockResolvedValueOnce(BOARD_RESPONSE_KANBAN);
    const hookRender = renderHook(() => useMetricsState());

    act(() => hookRender.result.current.setBoardId('42'));
    await act(async () => {
      await hookRender.result.current.reload();
    });

    expect(hookRender.result.current.boardType).toBe('kanban');
    expect(hookRender.result.current.predictability).toEqual([]);
    expect(hookRender.result.current.throughput).toEqual([]);
    expect(mockJiraGet).toHaveBeenCalledTimes(1);
  });

  it('loads simplified cycle time when project key is set', async () => {
    mockJiraGet
      .mockResolvedValueOnce(BOARD_RESPONSE_KANBAN)
      .mockResolvedValueOnce(CYCLE_TIME_RESPONSE);
    const hookRender = renderHook(() => useMetricsState());

    act(() => hookRender.result.current.setBoardId('42'));
    act(() => hookRender.result.current.setProjectKey('tbx'));
    await act(async () => {
      await hookRender.result.current.reload();
    });

    const cycleTimeSearchPath = String(mockJiraGet.mock.calls[1][0]);
    expect(decodeURIComponent(cycleTimeSearchPath)).toContain('project=TBX AND statusCategory=Done AND updated >= -90d');
    expect(hookRender.result.current.cycleTime).toEqual({ sampleCount: 2, meanDays: 2.5, medianDays: 2.5, p90Days: 3 });
  });

  it('surfaces a clean error when the board ID is invalid in Jira', async () => {
    mockJiraGet.mockRejectedValueOnce(new Error('Jira GET /rest/agile/1.0/board/999 failed: 404'));
    const hookRender = renderHook(() => useMetricsState());

    act(() => hookRender.result.current.setBoardId('999'));
    await act(async () => {
      await hookRender.result.current.reload();
    });

    expect(hookRender.result.current.errorMessage).toBe('Could not load metrics for that board. Check the board ID and Jira permissions.');
    expect(hookRender.result.current.predictability).toEqual([]);
  });

  it('handles forbidden Greenhopper sprint reports without crashing', async () => {
    mockJiraGet
      .mockResolvedValueOnce(BOARD_RESPONSE_SCRUM)
      .mockResolvedValueOnce({ values: [{ id: 1, name: 'Sprint 1', startDate: '2024-01-01T00:00:00.000Z' }] })
      .mockRejectedValueOnce(new Error('Jira GET /rest/greenhopper/1.0/rapid/charts/sprintreport failed: 403'));
    const hookRender = renderHook(() => useMetricsState());

    act(() => hookRender.result.current.setBoardId('42'));
    await act(async () => {
      await hookRender.result.current.reload();
    });

    expect(hookRender.result.current.predictability).toEqual([]);
    expect(hookRender.result.current.throughput).toEqual([]);
    expect(hookRender.result.current.errorMessage).toContain('Sprint report data is unavailable');
  });

  it('does not call Jira when the board ID is blank', async () => {
    const hookRender = renderHook(() => useMetricsState());

    await act(async () => {
      await hookRender.result.current.reload();
    });

    expect(mockJiraGet).not.toHaveBeenCalled();
    expect(hookRender.result.current.errorMessage).toBeNull();
  });
});
