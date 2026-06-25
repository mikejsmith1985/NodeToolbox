// useMentionsState.test.ts — Unit tests for the Mentions report orchestration hook.
// Jira and the mention-state API are mocked; we verify detection, addressed
// filtering, the show-addressed toggle, and optimistic mark-addressed.

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockJiraGet, mockFetchAddressed, mockSetAddressed, mockFetchProxyConfig } = vi.hoisted(() => ({
  mockJiraGet: vi.fn(),
  mockFetchAddressed: vi.fn(),
  mockSetAddressed: vi.fn(),
  mockFetchProxyConfig: vi.fn(),
}));

vi.mock('../../../services/jiraApi.ts', () => ({ jiraGet: mockJiraGet }));
vi.mock('../../../services/mentionStateApi.ts', () => ({
  fetchAddressedMentions: mockFetchAddressed,
  setMentionAddressed: mockSetAddressed,
}));
vi.mock('../../../services/proxyApi.ts', () => ({ fetchProxyConfig: mockFetchProxyConfig }));

import { useMentionsState } from './useMentionsState.ts';

const MYSELF = { accountId: 'acc-1', name: 'jsmith', key: 'jsmith', displayName: 'Jane Smith' };

function recentIso(): string {
  // A timestamp guaranteed to fall inside any positive business-day window.
  return new Date().toISOString();
}

function buildIssue(issueKey: string, commentId: string, body: string) {
  return {
    id: issueKey,
    key: issueKey,
    fields: {
      summary: `Summary ${issueKey}`,
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      priority: null,
      assignee: null,
      reporter: null,
      issuetype: { name: 'Story', iconUrl: '' },
      created: recentIso(),
      updated: recentIso(),
      description: null,
      comment: {
        total: 1,
        comments: [{ id: commentId, author: { displayName: 'Bob' }, body, created: recentIso() }],
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockJiraGet.mockImplementation((path: string) => {
    if (path.includes('/myself')) {
      return Promise.resolve(MYSELF);
    }
    return Promise.resolve({
      issues: [
        buildIssue('TBX-1', '101', 'ping [~jsmith] one'),
        buildIssue('TBX-2', '201', 'ping [~jsmith] two'),
      ],
    });
  });
  // TBX-1#101 has already been addressed previously.
  mockFetchAddressed.mockResolvedValue({ 'TBX-1#101': { addressedAt: 'x', issueKey: 'TBX-1' } });
  mockSetAddressed.mockResolvedValue({});
  mockFetchProxyConfig.mockResolvedValue({ jiraBaseUrl: 'https://jira.example.com' });
});

describe('useMentionsState', () => {
  it('loads mentions and hides ones already addressed by default', async () => {
    const { result } = renderHook(() => useMentionsState());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.visibleMentions.map((mention) => mention.mentionKey)).toEqual(['TBX-2#201']);
  });

  it('exposes the configured Jira base URL for building issue links', async () => {
    const { result } = renderHook(() => useMentionsState());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.jiraBaseUrl).toBe('https://jira.example.com');
  });

  it('still loads mentions when the proxy config fetch fails (empty base URL)', async () => {
    mockFetchProxyConfig.mockRejectedValue(new Error('config unavailable'));
    const { result } = renderHook(() => useMentionsState());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.jiraBaseUrl).toBe('');
    expect(result.current.visibleMentions.map((mention) => mention.mentionKey)).toEqual(['TBX-2#201']);
  });

  it('reveals addressed mentions when showAddressed is toggled on', async () => {
    const { result } = renderHook(() => useMentionsState());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.toggleShowAddressed());

    expect(result.current.visibleMentions.map((mention) => mention.mentionKey).sort()).toEqual([
      'TBX-1#101',
      'TBX-2#201',
    ]);
  });

  it('marks a mention addressed optimistically so it falls off the list', async () => {
    mockSetAddressed.mockResolvedValue({
      'TBX-1#101': { addressedAt: 'x', issueKey: 'TBX-1' },
      'TBX-2#201': { addressedAt: 'y', issueKey: 'TBX-2' },
    });
    const { result } = renderHook(() => useMentionsState());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const target = result.current.visibleMentions[0];
    await act(async () => {
      await result.current.markAddressed(target, true);
    });

    expect(mockSetAddressed).toHaveBeenCalledWith(
      expect.objectContaining({ userKey: 'acc-1', mentionKey: 'TBX-2#201', isAddressed: true }),
    );
    expect(result.current.visibleMentions).toHaveLength(0);
  });

  it('re-queries Jira when the business-day window changes', async () => {
    const { result } = renderHook(() => useMentionsState());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const searchCallsBefore = mockJiraGet.mock.calls.filter(([path]) => String(path).includes('/search')).length;

    act(() => result.current.setWindowBusinessDays(10));
    await waitFor(() => expect(result.current.windowBusinessDays).toBe(10));
    await waitFor(() => {
      const searchCallsAfter = mockJiraGet.mock.calls.filter(([path]) => String(path).includes('/search')).length;
      expect(searchCallsAfter).toBeGreaterThan(searchCallsBefore);
    });
  });
});
