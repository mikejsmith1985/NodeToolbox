// piNameSuggestions.test.ts — Unit tests for the shared PI-name autocomplete lookup.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockJiraGet } = vi.hoisted(() => ({ mockJiraGet: vi.fn() }));

vi.mock('./jiraApi.ts', () => ({ jiraGet: mockJiraGet }));

import { fetchPiNameSuggestions } from './piNameSuggestions.ts';

describe('fetchPiNameSuggestions', () => {
  beforeEach(() => {
    mockJiraGet.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('queries the PI field autocomplete and strips the surrounding quotes from values', async () => {
    mockJiraGet.mockResolvedValue({ results: [{ value: '"PI 26.4 (08/13/26 - 10/28/26)"' }] });

    const suggestions = await fetchPiNameSuggestions('customfield_10301');

    expect(suggestions).toContain('PI 26.4 (08/13/26 - 10/28/26)');
    const firstRequestUrl = mockJiraGet.mock.calls[0][0] as string;
    expect(firstRequestUrl).toContain('/rest/api/2/jql/autocompletedata/suggestions');
    expect(firstRequestUrl).toContain(`fieldName=${encodeURIComponent('cf[10301]')}`);
  });

  it('treats a failed autocomplete request as empty instead of throwing', async () => {
    mockJiraGet.mockRejectedValue(new Error('Jira 500'));
    await expect(fetchPiNameSuggestions('customfield_10301')).resolves.toEqual([]);
  });
});
