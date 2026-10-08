// changeJiraStories.test.ts — Finding and reading the Jira stories an existing change names (GH #415).

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { jiraGet } from '../../../services/jiraApi.ts';
import { fetchChangeJiraStories, findJiraKeysInChangeText, MAX_CHANGE_STORY_KEYS } from './changeJiraStories.ts';

vi.mock('../../../services/jiraApi.ts', () => ({ jiraGet: vi.fn() }));

describe('findJiraKeysInChangeText', () => {
  it('finds each Jira key once, in the order the change names them', () => {
    expect(findJiraKeysInChangeText([
      'Deploys ENCUC-77 and DENP-1359.',
      'Covers ENCUC-77 again, plus ENFCT-5.',
    ])).toEqual(['ENCUC-77', 'DENP-1359', 'ENFCT-5']);
  });

  it('ignores ServiceNow numbers and lower-case look-alikes', () => {
    expect(findJiraKeysInChangeText(['CHG0012345 and CTASK0012345 under ritm-4'])).toEqual([]);
  });

  it('reads at most a fixed number of keys, so a long change cannot flood Jira', () => {
    const manyKeys = Array.from({ length: MAX_CHANGE_STORY_KEYS + 5 }, (_unused, keyIndex) => `ENCUC-${keyIndex + 1}`);

    expect(findJiraKeysInChangeText([manyKeys.join(' ')])).toHaveLength(MAX_CHANGE_STORY_KEYS);
  });
});

describe('fetchChangeJiraStories', () => {
  beforeEach(() => {
    vi.mocked(jiraGet).mockReset();
  });

  it('reads each story with the fields the Enhance prompt uses', async () => {
    vi.mocked(jiraGet).mockResolvedValue({ key: 'ENCUC-77', fields: { summary: 'Fix recon totals' } });

    const stories = await fetchChangeJiraStories(['ENCUC-77']);

    expect(stories.map((story) => story.key)).toEqual(['ENCUC-77']);
    expect(vi.mocked(jiraGet).mock.calls[0][0]).toMatch(/^\/rest\/api\/2\/issue\/ENCUC-77\?fields=summary,[^&]*description/);
  });

  it('skips a key Jira cannot find — a look-alike such as SHA-256 — and keeps the rest', async () => {
    vi.mocked(jiraGet).mockImplementation(async (requestPath: string) => {
      if (requestPath.includes('SHA-256')) throw new Error('Jira GET failed: 404');
      return { key: 'ENCUC-77', fields: { summary: 'Fix recon totals' } };
    });

    const stories = await fetchChangeJiraStories(['SHA-256', 'ENCUC-77']);

    expect(stories.map((story) => story.key)).toEqual(['ENCUC-77']);
  });
});
