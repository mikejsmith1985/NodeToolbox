// useSimpleSearchState.test.ts — Unit tests for the Business Helper hidden Jira search state hook.

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockJiraGet } = vi.hoisted(() => ({
  mockJiraGet: vi.fn(),
}));

vi.mock('../../../services/jiraApi.ts', () => ({
  jiraGet: mockJiraGet,
}));

import {
  buildSimpleSearchPath,
  detectKeywordMatchLocation,
  type SimpleSearchRelationshipIssue,
  useSimpleSearchState,
} from './useSimpleSearchState.ts';

function createMockIssue(
  issueKey: string,
  issueTypeName: string,
  summary: string,
  description: unknown,
) {
  return {
    id: issueKey,
    key: issueKey,
    fields: {
      summary,
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      priority: { name: 'Medium', iconUrl: 'priority.png' },
      assignee: { accountId: '123', displayName: 'Alex Analyst', emailAddress: 'alex@example.com', avatarUrls: {} },
      reporter: null,
      issuetype: { name: issueTypeName, iconUrl: 'type.png' },
      created: '2026-05-01T00:00:00.000Z',
      updated: '2026-05-20T00:00:00.000Z',
      description,
    },
  };
}

describe('useSimpleSearchState helpers', () => {
  it('builds an encoded search path that avoids fragile issue type filters', () => {
    const searchPath = buildSimpleSearchPath('release readiness');
    const decodedSearchPath = decodeURIComponent(searchPath);

    expect(decodedSearchPath).toContain('summary ~ "release readiness" OR description ~ "release readiness"');
    expect(decodedSearchPath).toContain(
      'jql=(summary ~ "release readiness" OR description ~ "release readiness") ORDER BY updated DESC',
    );
    expect(decodedSearchPath).not.toContain('AND ORDER BY');
    expect(decodedSearchPath).not.toContain('issuetype in (');
    expect(decodedSearchPath).toContain('fields=summary,status,assignee,issuetype,created,updated,description');
  });

  it('detects when the keyword appears in the Jira description only', () => {
    expect(detectKeywordMatchLocation('budget', 'Release planning', 'The budget approval moved forward')).toBe(
      'description',
    );
  });
});

describe('useSimpleSearchState', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('runs the hidden Jira query, maps hierarchy metadata, and sorts summary matches first', async () => {
    mockJiraGet.mockResolvedValue({
      issues: [
        createMockIssue('TBX-99', 'Epic', 'Unsupported type result', 'Should be filtered out'),
        createMockIssue('TBX-2', 'Feature', 'Pipeline update', 'The finance keyword is in the description only.'),
        createMockIssue('TBX-1', 'Story', 'Finance dashboard update', 'No extra context'),
      ],
      total: 3,
    });

    const { result } = renderHook(() => useSimpleSearchState());

    act(() => {
      result.current.setKeyword('finance');
    });

    await act(async () => {
      await result.current.runSearch();
    });

    await waitFor(() => {
      expect(result.current.rawResultCount).toBe(2);
      expect(result.current.results).toHaveLength(2);
      expect(result.current.results[0].key).toBe('TBX-1');
      expect(result.current.results[0].matchLocation).toBe('summary');
      expect(result.current.results[0].hierarchyLevel).toBe('team');
      expect(result.current.results[1].hierarchyLevel).toBe('art');
    });

    expect(mockJiraGet).toHaveBeenCalledTimes(1);
    expect(decodeURIComponent(mockJiraGet.mock.calls[0][0])).toContain('summary ~ "finance" OR description ~ "finance"');
  });

  it('stores a readable error when Jira search fails', async () => {
    mockJiraGet.mockRejectedValue(new Error('Search failed'));

    const { result } = renderHook(() => useSimpleSearchState());

    act(() => {
      result.current.setKeyword('finance');
    });

    await act(async () => {
      await result.current.runSearch();
    });

    await waitFor(() => {
      expect(result.current.errorMessage).toBe('Search failed');
      expect(result.current.hasSearched).toBe(false);
      expect(result.current.results).toEqual([]);
    });
  });

  it('loads detail content with child and linked relationship records for an expanded result row', async () => {
    mockJiraGet
      .mockResolvedValueOnce({
        key: 'TBX-1',
        fields: {
          description: 'Expanded description',
          issuetype: { name: 'Feature' },
          issuelinks: [
            {
              type: { outward: 'blocks' },
              outwardIssue: {
                key: 'TBX-9',
                fields: {
                  summary: 'Linked issue',
                  status: { name: 'To Do' },
                  issuetype: { name: 'Bug' },
                },
              },
            },
          ],
          subtasks: [],
        },
      })
      .mockRejectedValueOnce(new Error('Jira GET /rest/api/2/search failed: 400'))
      .mockResolvedValueOnce({
        issues: [
          {
            key: 'TBX-2',
            fields: {
              summary: 'Child story',
              status: { name: 'In Progress' },
              issuetype: { name: 'Story' },
            },
          },
        ],
      });

    const { result } = renderHook(() => useSimpleSearchState());

    await act(async () => {
      await result.current.loadIssueDetail('TBX-1');
    });

    await waitFor(() => {
      const issueDetail = result.current.detailByIssueKey['TBX-1'];
      expect(issueDetail?.description).toBe('Expanded description');
      expect(issueDetail?.childIssues).toEqual([
        expect.objectContaining<Partial<SimpleSearchRelationshipIssue>>({
          key: 'TBX-2',
          relationshipKind: 'child',
          relationshipLabel: 'Child',
        }),
      ]);
      expect(issueDetail?.linkedIssues).toEqual([
        expect.objectContaining<Partial<SimpleSearchRelationshipIssue>>({
          key: 'TBX-9',
          relationshipKind: 'linked',
          relationshipLabel: 'blocks',
        }),
      ]);
    });
  });
});
