// useStoryPointingState.test.ts — Hook tests for the Story Pointing single-user planning deck.

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  STORY_POINTING_STORAGE_KEY,
  buildIssueSearchPath,
  computeCanPersistVote,
  mapJiraIssueToStoryPointingIssue,
  useStoryPointingState,
  type PersistedStoryPointingState,
} from './useStoryPointingState.ts';

vi.mock('../../../services/jiraApi.ts', () => ({
  jiraGet: vi.fn(),
  jiraPut: vi.fn(),
}));

import { jiraGet, jiraPut } from '../../../services/jiraApi.ts';

const mockJiraGet = vi.mocked(jiraGet);
const mockJiraPut = vi.mocked(jiraPut);

const SAMPLE_SEARCH_RESPONSE = {
  issues: [
    {
      key: 'TBX-101',
      fields: {
        summary: 'Build single-user pointing deck',
        description: 'As a facilitator, I can point one issue at a time.',
        status: { name: 'Ready' },
        priority: { name: 'High' },
        issuetype: { name: 'Story' },
        assignee: { displayName: 'Alex' },
        customfield_10028: null,
      },
    },
    {
      key: 'TBX-102',
      fields: {
        summary: 'Persist selected estimate',
        description: null,
        status: { name: 'To Do' },
        priority: { name: 'Medium' },
        issuetype: { name: 'Task' },
        assignee: null,
        customfield_10016: 3,
      },
    },
  ],
};

beforeEach(() => {
  mockJiraGet.mockReset();
  mockJiraPut.mockReset();
  window.localStorage.clear();
});

describe('helpers', () => {
  it('buildIssueSearchPath converts comma-separated issue keys into a Jira issuekey JQL search', () => {
    const searchPath = buildIssueSearchPath('TBX-101, tbx-102');

    expect(decodeURIComponent(searchPath)).toContain('jql=issuekey in (TBX-101, TBX-102)');
    expect(searchPath).toContain('maxResults=50');
  });

  it('buildIssueSearchPath treats non-key input as raw JQL so facilitators can paste saved filters', () => {
    const searchPath = buildIssueSearchPath('project = TBX AND statusCategory != Done');

    expect(decodeURIComponent(searchPath)).toContain('jql=project = TBX AND statusCategory != Done');
  });

  it('mapJiraIssueToStoryPointingIssue reads the visible card fields and both known point fields', () => {
    const mappedIssue = mapJiraIssueToStoryPointingIssue(SAMPLE_SEARCH_RESPONSE.issues[1]);

    expect(mappedIssue).toEqual({
      key: 'TBX-102',
      summary: 'Persist selected estimate',
      description: '',
      issueType: 'Task',
      status: 'To Do',
      priority: 'Medium',
      assignee: '',
      storyPoints: 3,
    });
  });

  it('computeCanPersistVote only allows revealed numeric votes to be saved back to Jira', () => {
    expect(computeCanPersistVote(5, true)).toBe(true);
    expect(computeCanPersistVote('?', true)).toBe(false);
    expect(computeCanPersistVote(5, false)).toBe(false);
    expect(computeCanPersistVote(null, true)).toBe(false);
  });
});

describe('useStoryPointingState', () => {
  it('starts with an empty planning deck and the default issue search', () => {
    const { result } = renderHook(() => useStoryPointingState());

    expect(result.current.deck).toEqual([]);
    expect(result.current.currentIssue).toBeNull();
    expect(result.current.selectedVote).toBeNull();
    expect(result.current.isRevealed).toBe(false);
    expect(result.current.queryText).toContain('statusCategory != Done');
  });

  it('loads issues from Jira, maps them into the deck, and persists the deck locally', async () => {
    mockJiraGet.mockResolvedValue(SAMPLE_SEARCH_RESPONSE);
    const { result } = renderHook(() => useStoryPointingState());

    act(() => result.current.setQueryText('TBX-101,TBX-102'));
    await act(async () => {
      await result.current.loadIssues();
    });

    expect(mockJiraGet).toHaveBeenCalledWith(expect.stringContaining('issuekey%20in'));
    expect(result.current.deck).toHaveLength(2);
    expect(result.current.currentIssue?.key).toBe('TBX-101');
    expect(result.current.loadError).toBeNull();

    const storedJson = window.localStorage.getItem(STORY_POINTING_STORAGE_KEY);
    expect(storedJson).toContain('TBX-101');
  });

  it('restores the persisted deck so a browser refresh does not lose progress', () => {
    const persistedState: PersistedStoryPointingState = {
      queryText: 'TBX-101',
      deck: [mapJiraIssueToStoryPointingIssue(SAMPLE_SEARCH_RESPONSE.issues[0])],
      currentIssueIndex: 0,
      selectedVote: 8,
      isRevealed: true,
      session: { pointedCount: 1, skippedCount: 0 },
    };
    window.localStorage.setItem(STORY_POINTING_STORAGE_KEY, JSON.stringify(persistedState));

    const { result } = renderHook(() => useStoryPointingState());

    expect(result.current.currentIssue?.key).toBe('TBX-101');
    expect(result.current.selectedVote).toBe(8);
    expect(result.current.isRevealed).toBe(true);
    expect(result.current.session.pointedCount).toBe(1);
  });

  it('selects, reveals, and resets a vote without mutating the issue deck', () => {
    const { result } = renderHook(() => useStoryPointingState());

    act(() => result.current.selectVote(13));
    act(() => result.current.revealVotes());

    expect(result.current.selectedVote).toBe(13);
    expect(result.current.isRevealed).toBe(true);

    act(() => result.current.resetVote());

    expect(result.current.selectedVote).toBeNull();
    expect(result.current.isRevealed).toBe(false);
  });

  it('skips the current issue and can navigate back to the previous card', async () => {
    mockJiraGet.mockResolvedValue(SAMPLE_SEARCH_RESPONSE);
    const { result } = renderHook(() => useStoryPointingState());

    await act(async () => {
      await result.current.loadIssues();
    });
    act(() => result.current.skipIssue());

    expect(result.current.currentIssue?.key).toBe('TBX-102');
    expect(result.current.session.skippedCount).toBe(1);

    act(() => result.current.goToPreviousIssue());

    expect(result.current.currentIssue?.key).toBe('TBX-101');
  });

  it('saves a revealed numeric vote to Jira, updates local points, and advances the deck', async () => {
    mockJiraGet.mockResolvedValue(SAMPLE_SEARCH_RESPONSE);
    mockJiraPut.mockResolvedValue(undefined);
    const { result } = renderHook(() => useStoryPointingState());

    await act(async () => {
      await result.current.loadIssues();
    });
    act(() => result.current.selectVote(5));
    act(() => result.current.revealVotes());
    await act(async () => {
      await result.current.saveRevealedVote();
    });

    expect(mockJiraPut).toHaveBeenCalledWith('/rest/api/2/issue/TBX-101', {
      fields: { customfield_10028: 5 },
    });
    expect(result.current.deck[0].storyPoints).toBe(5);
    expect(result.current.currentIssue?.key).toBe('TBX-102');
    expect(result.current.session.pointedCount).toBe(1);
    expect(result.current.selectedVote).toBeNull();
  });

  it('keeps the current card active and reports a save error when Jira rejects the PUT', async () => {
    mockJiraGet.mockResolvedValue(SAMPLE_SEARCH_RESPONSE);
    mockJiraPut.mockRejectedValue(new Error('forbidden'));
    const { result } = renderHook(() => useStoryPointingState());

    await act(async () => {
      await result.current.loadIssues();
    });
    act(() => result.current.selectVote(8));
    act(() => result.current.revealVotes());
    await act(async () => {
      await result.current.saveRevealedVote();
    });

    await waitFor(() => expect(result.current.saveStatusMessage).toContain('forbidden'));
    expect(result.current.currentIssue?.key).toBe('TBX-101');
    expect(result.current.session.pointedCount).toBe(0);
  });
});
