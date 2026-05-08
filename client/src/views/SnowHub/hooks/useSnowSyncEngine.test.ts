// useSnowSyncEngine.test.ts — Unit tests for the PRB sync monitor state machine and sync logic.

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { jiraGet } from '../../../services/jiraApi.ts';
import { snowFetch } from '../../../services/snowApi.ts';
import { generatePs1Script, useSnowSyncEngine } from './useSnowSyncEngine.ts';
import type { IssueStateMap, StatusMap, SyncSettings } from './useSnowSyncEngine.ts';

vi.mock('../../../services/jiraApi.ts', () => ({
  jiraGet: vi.fn(),
}));

vi.mock('../../../services/snowApi.ts', () => ({
  snowFetch: vi.fn(),
}));

const STORAGE_KEY_ISSUE_STATE = 'tbxPrbSyncState';
const STORAGE_KEY_SETTINGS = 'tbxPRBSyncSettings';
const STORAGE_KEY_STATUS_MAP = 'tbxPrbSyncMappings';

describe('useSnowSyncEngine', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('starts with isRunning false and empty log', () => {
    const { result } = renderHook(() => useSnowSyncEngine());

    expect(result.current.state.isRunning).toBe(false);
    expect(result.current.state.logEntries).toEqual([]);
  });

  it('loads default settings when localStorage is empty', () => {
    const { result } = renderHook(() => useSnowSyncEngine());

    expect(result.current.state.settings.intervalMin).toBe(15);
    expect(result.current.state.settings.shouldSyncComments).toBe(true);
    expect(result.current.state.settings.workNotePrefix).toBe('[Jira Sync]');
  });

  it('loads saved settings from localStorage', () => {
    const savedSettings: SyncSettings = {
      jqlTemplate: 'project = TEST',
      intervalMin: 30,
      workNotePrefix: '[Custom]',
      shouldSyncComments: false,
      lastCheckTime: '2026-01-01T00:00:00.000Z',
    };
    localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(savedSettings));

    const { result } = renderHook(() => useSnowSyncEngine());

    expect(result.current.state.settings.intervalMin).toBe(30);
    expect(result.current.state.settings.workNotePrefix).toBe('[Custom]');
  });

  it('clears log when clearLog is called', async () => {
    vi.mocked(jiraGet).mockResolvedValue({ issues: [] });
    const { result } = renderHook(() => useSnowSyncEngine());

    await act(async () => {
      await result.current.actions.runNow();
    });

    expect(result.current.state.logEntries.length).toBeGreaterThan(0);

    act(() => {
      result.current.actions.clearLog();
    });

    expect(result.current.state.logEntries).toEqual([]);
  });

  it('appends info log entry after runNow with no issues', async () => {
    vi.mocked(jiraGet).mockResolvedValue({ issues: [] });
    const { result } = renderHook(() => useSnowSyncEngine());

    await act(async () => {
      await result.current.actions.runNow();
    });

    await waitFor(() => {
      const searchCompleteEntry = result.current.state.logEntries.find(
        (entry) => entry.detail.includes('Search complete'),
      );
      expect(searchCompleteEntry).toBeDefined();
    });
  });

  it('logs error entry when Jira search fails', async () => {
    vi.mocked(jiraGet).mockRejectedValue(new Error('Jira unavailable'));
    const { result } = renderHook(() => useSnowSyncEngine());

    await act(async () => {
      await result.current.actions.runNow();
    });

    await waitFor(() => {
      const errorEntry = result.current.state.logEntries.find((entry) => entry.type === 'error');
      expect(errorEntry).toBeDefined();
      expect(errorEntry?.detail).toContain('Jira unavailable');
    });
  });

  it('tracks new issue when it appears in Jira search for first time', async () => {
    const mockIssue = {
      key: 'PROJ-1',
      fields: {
        summary: 'PRB0001234 - Login failure affecting all users',
        status: { name: 'Open' },
        comment: { total: 0, comments: [] },
        updated: '2026-01-01T00:00:00.000Z',
      },
    };
    vi.mocked(jiraGet).mockResolvedValue({ issues: [mockIssue] });

    const { result } = renderHook(() => useSnowSyncEngine());

    await act(async () => {
      await result.current.actions.runNow();
    });

    await waitFor(() => {
      const trackingEntry = result.current.state.logEntries.find((entry) =>
        entry.detail.includes('Now tracking'),
      );
      expect(trackingEntry).toBeDefined();
      expect(trackingEntry?.jiraKey).toBe('PROJ-1');
      expect(trackingEntry?.prbNumber).toBe('PRB0001234');
    });
  });

  it('syncs status change for tracked issue', async () => {
    const trackedState: IssueStateMap = {
      'PROJ-2': {
        prbNumber: 'PRB0001235',
        lastStatus: 'Open',
        lastCommentCount: 0,
        lastSynced: '2026-01-01T00:00:00.000Z',
      },
    };
    localStorage.setItem(STORAGE_KEY_ISSUE_STATE, JSON.stringify(trackedState));

    const mockIssue = {
      key: 'PROJ-2',
      fields: {
        summary: 'PRB0001235 - Database connectivity issue',
        status: { name: 'In Progress' },
        comment: { total: 0, comments: [] },
        updated: '2026-01-02T00:00:00.000Z',
      },
    };
    vi.mocked(jiraGet).mockResolvedValue({ issues: [mockIssue] });
    vi.mocked(snowFetch)
      .mockResolvedValueOnce({ result: [{ sys_id: 'sys-abc-123' }] })
      .mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useSnowSyncEngine());

    await act(async () => {
      await result.current.actions.runNow();
    });

    await waitFor(() => {
      const statusEntry = result.current.state.logEntries.find((entry) => entry.type === 'status');
      expect(statusEntry).toBeDefined();
      expect(statusEntry?.jiraKey).toBe('PROJ-2');
    });
  });

  it('saves status mappings to localStorage when saveStatusMappings called', () => {
    const { result } = renderHook(() => useSnowSyncEngine());
    const testMap: StatusMap = { 'In Progress': '104', Done: '106' };

    act(() => {
      result.current.actions.saveStatusMappings(testMap);
    });

    const storedValue = localStorage.getItem(STORAGE_KEY_STATUS_MAP);
    expect(storedValue).not.toBeNull();
    expect(JSON.parse(storedValue!)).toEqual(testMap);
  });

  it('updates settings state when updateSettings called', () => {
    const { result } = renderHook(() => useSnowSyncEngine());

    act(() => {
      result.current.actions.updateSettings({ intervalMin: 30 });
    });

    expect(result.current.state.settings.intervalMin).toBe(30);
  });

  it('populates jiraStatuses after fetchJiraStatuses succeeds', async () => {
    vi.mocked(jiraGet).mockResolvedValue([{ name: 'To Do' }, { name: 'In Progress' }]);

    const { result } = renderHook(() => useSnowSyncEngine());

    await act(async () => {
      await result.current.actions.fetchJiraStatuses();
    });

    await waitFor(() => {
      expect(result.current.state.jiraStatuses).toContain('To Do');
      expect(result.current.state.jiraStatuses).toContain('In Progress');
    });
  });

  it('generatePs1Script contains interval and prefix', () => {
    const testSettings: SyncSettings = {
      jqlTemplate: 'issuetype = Problem',
      intervalMin: 30,
      workNotePrefix: '[Test Prefix]',
      shouldSyncComments: true,
      lastCheckTime: null,
    };

    const scriptOutput = generatePs1Script(testSettings, {});

    expect(scriptOutput).toContain('30');
    expect(scriptOutput).toContain('[Test Prefix]');
  });
});
