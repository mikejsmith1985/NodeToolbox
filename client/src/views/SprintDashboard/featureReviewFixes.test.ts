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
  saveFeatureReviewStoryPoints,
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

  // ── saveFeatureReviewStoryPoints: editmeta-aware (GH #167) ──

  it('writes story points to the first standard field the issue’s edit screen carries', async () => {
    mockJiraGet.mockResolvedValue({ fields: { customfield_10028: { name: 'Story Points' } } });
    mockJiraPut.mockResolvedValue(undefined);

    await saveFeatureReviewStoryPoints('ENCUC-2135', '3');

    expect(mockJiraPut).toHaveBeenCalledWith('/rest/api/2/issue/ENCUC-2135', {
      fields: { customfield_10028: 3 },
    });
  });

  it('falls back to an editable field NAMED like story points when no standard id is on the screen', async () => {
    // The GH #167 failure: neither configured nor legacy ids were settable, and the blind write
    // died with Jira's "not on the appropriate screen" 400. The screen's own field wins instead.
    mockJiraGet.mockResolvedValue({ fields: { customfield_99001: { name: 'Story Points (QA)' } } });
    mockJiraPut.mockResolvedValue(undefined);

    await saveFeatureReviewStoryPoints('ENCUC-2135', '5');

    expect(mockJiraPut).toHaveBeenCalledWith('/rest/api/2/issue/ENCUC-2135', {
      fields: { customfield_99001: 5 },
    });
  });

  it('fails with a readable message when no story-points field is editable, instead of a screen 400', async () => {
    mockJiraGet.mockResolvedValue({ fields: { summary: { name: 'Summary' } } });

    await expect(saveFeatureReviewStoryPoints('ENCUC-2135', '5')).rejects.toThrow(
      /No story-points field is editable/,
    );
    expect(mockJiraPut).not.toHaveBeenCalled();
  });

  // ── saveFeatureReviewStoryPoints: dropdown-style fields (GH #177) ──

  it('writes a dropdown story-points field as the matching allowed OPTION, never a raw number', async () => {
    // A Select-type points field rejects `3` with Jira's "Could not find valid 'id' or 'value'
    // in the Parent Option object" 400 — the payload must be the option object.
    mockJiraGet.mockResolvedValue({
      fields: {
        customfield_10028: {
          name: 'Story Points',
          allowedValues: [
            { id: '9001', value: '1' },
            { id: '9003', value: '3' },
            { id: '9005', value: '5' },
          ],
        },
      },
    });
    mockJiraPut.mockResolvedValue(undefined);

    await saveFeatureReviewStoryPoints('ENCUC-2135', '3');

    expect(mockJiraPut).toHaveBeenCalledWith('/rest/api/2/issue/ENCUC-2135', {
      fields: { customfield_10028: { id: '9003' } },
    });
  });

  it('matches a dropdown option numerically, so "3" finds an option labelled "3.0"', async () => {
    mockJiraGet.mockResolvedValue({
      fields: {
        customfield_10028: {
          name: 'Story Points',
          allowedValues: [{ value: '3.0' }],
        },
      },
    });
    mockJiraPut.mockResolvedValue(undefined);

    await saveFeatureReviewStoryPoints('ENCUC-2135', '3');

    expect(mockJiraPut).toHaveBeenCalledWith('/rest/api/2/issue/ENCUC-2135', {
      fields: { customfield_10028: { value: '3.0' } },
    });
  });

  it('lists the dropdown options in a readable error when the number matches none of them', async () => {
    mockJiraGet.mockResolvedValue({
      fields: {
        customfield_10028: {
          name: 'Story Points',
          allowedValues: [{ id: '9001', value: '1' }, { id: '9002', value: '2' }],
        },
      },
    });

    await expect(saveFeatureReviewStoryPoints('ENCUC-2135', '4')).rejects.toThrow(
      /dropdown with no option matching "4".*1, 2/,
    );
    expect(mockJiraPut).not.toHaveBeenCalled();
  });
});
