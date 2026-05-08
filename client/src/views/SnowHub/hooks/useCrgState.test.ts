// useCrgState.test.ts — Unit tests for the Change Request Generator state hook.

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { jiraGet } from '../../../services/jiraApi.ts';
import { useCrgState } from './useCrgState.ts';

vi.mock('../../../services/jiraApi.ts', () => ({
  jiraGet: vi.fn(),
}));

function createMockJiraIssue(issueKey: string, summary: string) {
  return {
    id: issueKey,
    key: issueKey,
    fields: {
      summary,
      status: { name: 'To Do', statusCategory: { key: 'new' } },
      priority: { name: 'Medium', iconUrl: 'priority.png' },
      assignee: null,
      reporter: null,
      issuetype: { name: 'Story', iconUrl: 'story.png' },
      created: '2025-01-01T00:00:00.000Z',
      updated: '2025-01-01T00:00:00.000Z',
      description: null,
    },
  };
}

const MOCK_JIRA_ISSUES = [
  createMockJiraIssue('ABC-101', 'Prepare deployment notes'),
  createMockJiraIssue('ABC-102', 'Finish smoke tests'),
];

describe('useCrgState', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  function mockVersionFetch() {
    vi.mocked(jiraGet).mockResolvedValue([] as never);
  }

  it('starts on step 1 with an empty project key', () => {
    const { result } = renderHook(() => useCrgState());

    expect(result.current.state.currentStep).toBe(1);
    expect(result.current.state.projectKey).toBe('');
  });

  it('uppercases the project key when it is updated', () => {
    mockVersionFetch();
    const { result } = renderHook(() => useCrgState());

    act(() => {
      result.current.actions.setProjectKey('tool');
    });

    expect(result.current.state.projectKey).toBe('TOOL');
  });

  it('fetches unreleased fix versions when the project key changes', async () => {
    vi.mocked(jiraGet)
      .mockResolvedValueOnce([
        { id: '1', name: '1.2.3', released: false },
        { id: '2', name: '1.2.2', released: true },
      ] as never);

    const { result } = renderHook(() => useCrgState());

    act(() => {
      result.current.actions.setProjectKey('abc');
    });

    await waitFor(() => {
      expect(result.current.state.availableFixVersions).toEqual(['1.2.3']);
    });
  });

  it('adds and removes an issue key when selection is toggled', () => {
    const { result } = renderHook(() => useCrgState());

    act(() => {
      result.current.actions.toggleIssueSelection('ABC-101');
    });

    expect(result.current.state.selectedIssueKeys.has('ABC-101')).toBe(true);

    act(() => {
      result.current.actions.toggleIssueSelection('ABC-101');
    });

    expect(result.current.state.selectedIssueKeys.has('ABC-101')).toBe(false);
  });

  it('selects every fetched issue when selectAllIssues(true) is used', async () => {
    vi.mocked(jiraGet)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce({ issues: MOCK_JIRA_ISSUES } as never);
    const { result } = renderHook(() => useCrgState());

    act(() => {
      result.current.actions.setProjectKey('abc');
      result.current.actions.setFixVersion('1.2.3');
    });

    await act(async () => {
      await result.current.actions.fetchIssues();
    });

    act(() => {
      result.current.actions.selectAllIssues(false);
      result.current.actions.selectAllIssues(true);
    });

    expect(result.current.state.selectedIssueKeys.size).toBe(2);
    expect(result.current.state.selectedIssueKeys.has('ABC-101')).toBe(true);
    expect(result.current.state.selectedIssueKeys.has('ABC-102')).toBe(true);
  });

  it('clears every selected issue when selectAllIssues(false) is used', async () => {
    vi.mocked(jiraGet)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce({ issues: MOCK_JIRA_ISSUES } as never);
    const { result } = renderHook(() => useCrgState());

    act(() => {
      result.current.actions.setProjectKey('abc');
      result.current.actions.setFixVersion('1.2.3');
    });

    await act(async () => {
      await result.current.actions.fetchIssues();
    });

    act(() => {
      result.current.actions.selectAllIssues(false);
    });

    expect(result.current.state.selectedIssueKeys.size).toBe(0);
  });

  it('generates release documentation that includes issue keys and advances to step 3', async () => {
    vi.mocked(jiraGet)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce({ issues: MOCK_JIRA_ISSUES } as never);
    const { result } = renderHook(() => useCrgState());

    act(() => {
      result.current.actions.setProjectKey('abc');
      result.current.actions.setFixVersion('1.2.3');
    });

    await act(async () => {
      await result.current.actions.fetchIssues();
    });

    act(() => {
      result.current.actions.generateDocs();
    });

    expect(result.current.state.generatedDescription).toContain('ABC-101');
    expect(result.current.state.generatedDescription).toContain('ABC-102');
    expect(result.current.state.currentStep).toBe(3);
  });

  it('updates the selected environment configuration', () => {
    const { result } = renderHook(() => useCrgState());

    act(() => {
      result.current.actions.updateEnvironment('rel', {
        plannedStartDate: '2025-02-01T08:00',
        plannedEndDate: '2025-02-01T10:00',
      });
    });

    expect(result.current.state.relEnvironment.plannedStartDate).toBe('2025-02-01T08:00');
    expect(result.current.state.relEnvironment.plannedEndDate).toBe('2025-02-01T10:00');
  });

  it('moves to a different step when goToStep is used', () => {
    const { result } = renderHook(() => useCrgState());

    act(() => {
      result.current.actions.goToStep(4);
    });

    expect(result.current.state.currentStep).toBe(4);
  });

  it('resets the workflow back to the initial state', async () => {
    vi.mocked(jiraGet)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce({ issues: MOCK_JIRA_ISSUES } as never);
    const { result } = renderHook(() => useCrgState());

    act(() => {
      result.current.actions.setProjectKey('abc');
      result.current.actions.setFixVersion('1.2.3');
    });

    await act(async () => {
      await result.current.actions.fetchIssues();
    });

    act(() => {
      result.current.actions.generateDocs();
      result.current.actions.reset();
    });

    await waitFor(() => {
      expect(result.current.state.currentStep).toBe(1);
      expect(result.current.state.projectKey).toBe('');
      expect(result.current.state.selectedIssueKeys.size).toBe(0);
    });
  });
});
