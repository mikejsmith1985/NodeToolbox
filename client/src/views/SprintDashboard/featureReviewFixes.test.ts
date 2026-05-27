// featureReviewFixes.test.ts — Unit tests for Jira user-search and direct-fix compatibility in Team Dashboard Feature Review.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockJiraGet, mockJiraPost, mockJiraPut } = vi.hoisted(() => ({
  mockJiraGet: vi.fn(),
  mockJiraPost: vi.fn(),
  mockJiraPut: vi.fn(),
}));

vi.mock('../../services/jiraApi.ts', () => ({
  jiraGet: mockJiraGet,
  jiraPost: mockJiraPost,
  jiraPut: mockJiraPut,
}));

import {
  fetchFeatureReviewTransitions,
  saveFeatureReviewTransition,
  saveFeatureReviewUserField,
  searchFeatureReviewUsers,
} from './featureReviewFixes.ts';

describe('featureReviewFixes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('searches Feature Review users with the modern Jira query parameter by default', async () => {
    mockJiraGet.mockResolvedValue([
      { accountId: 'abc-123', displayName: 'Jordan Watkins' },
    ]);

    await expect(searchFeatureReviewUsers('watkins')).resolves.toEqual([
      { userIdentifier: 'accountId:abc-123', displayName: 'Jordan Watkins' },
    ]);
    expect(mockJiraGet).toHaveBeenCalledWith('/rest/api/2/user/search?query=watkins&maxResults=8');
  });

  it('falls back to the legacy username parameter when Jira rejects the modern user-search query parameter', async () => {
    mockJiraGet
      .mockRejectedValueOnce(new Error('Jira GET /rest/api/2/user/search?query=watkins&maxResults=8 failed: 400 — The username query parameter was not provided.'))
      .mockResolvedValueOnce([
        { name: 'watkins', displayName: 'Jordan Watkins' },
        { key: 'legacy-key', displayName: 'Jordan W.' },
      ]);

    await expect(searchFeatureReviewUsers('watkins')).resolves.toEqual([
      { userIdentifier: 'name:watkins', displayName: 'Jordan Watkins' },
      { userIdentifier: 'key:legacy-key', displayName: 'Jordan W.' },
    ]);
    expect(mockJiraGet).toHaveBeenNthCalledWith(1, '/rest/api/2/user/search?query=watkins&maxResults=8');
    expect(mockJiraGet).toHaveBeenNthCalledWith(2, '/rest/api/2/user/search?username=watkins&maxResults=8');
  });

  it('saves modern Jira users with an accountId payload', async () => {
    mockJiraPut.mockResolvedValue(undefined);

    await saveFeatureReviewUserField('ART-5000', 'assignee', 'accountId:abc-123');

    expect(mockJiraPut).toHaveBeenCalledWith('/rest/api/2/issue/ART-5000', {
      fields: {
        assignee: { accountId: 'abc-123' },
      },
    });
  });

  it('saves legacy Jira users with a name payload', async () => {
    mockJiraPut.mockResolvedValue(undefined);

    await saveFeatureReviewUserField('ART-5000', 'assignee', 'name:watkins');

    expect(mockJiraPut).toHaveBeenCalledWith('/rest/api/2/issue/ART-5000', {
      fields: {
        assignee: { name: 'watkins' },
      },
    });
  });

  it('rejects malformed Jira user identifiers before sending a bad Jira payload', async () => {
    await expect(saveFeatureReviewUserField('ART-5000', 'assignee', 'accountId:')).rejects.toThrow(
      'Select a Jira user before saving.',
    );
    expect(mockJiraPut).not.toHaveBeenCalled();
  });

  it('fetches available Jira transitions for Feature Review status changes', async () => {
    mockJiraGet.mockResolvedValue({
      transitions: [
        { id: '31', name: 'Start Progress', to: { name: 'In Progress', statusCategory: { name: 'In Progress' } } },
        { id: '41', name: 'Done', to: { name: 'Done', statusCategory: { name: 'Done' } } },
      ],
    });

    await expect(fetchFeatureReviewTransitions('ART-5000')).resolves.toEqual([
      { id: '31', name: 'Start Progress', to: { name: 'In Progress', statusCategory: { name: 'In Progress' } } },
      { id: '41', name: 'Done', to: { name: 'Done', statusCategory: { name: 'Done' } } },
    ]);
    expect(mockJiraGet).toHaveBeenCalledWith('/rest/api/2/issue/ART-5000/transitions');
  });

  it('saves a Jira transition from Feature Review', async () => {
    mockJiraPost.mockResolvedValue(undefined);

    await saveFeatureReviewTransition('ART-5000', '31');

    expect(mockJiraPost).toHaveBeenCalledWith('/rest/api/2/issue/ART-5000/transitions', {
      transition: { id: '31' },
    });
  });

  it('rejects empty Jira transition selections before sending a transition request', async () => {
    await expect(saveFeatureReviewTransition('ART-5000', '')).rejects.toThrow(
      'Select a Jira transition before saving.',
    );
    expect(mockJiraPost).not.toHaveBeenCalled();
  });
});
