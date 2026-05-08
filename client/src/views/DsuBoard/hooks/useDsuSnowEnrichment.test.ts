// useDsuSnowEnrichment.test.ts — Unit tests for DSU Board ServiceNow link enrichment helpers.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JiraIssue } from '../../../types/jira.ts';

const { mockJiraGet } = vi.hoisted(() => ({
  mockJiraGet: vi.fn(),
}));

vi.mock('../../../services/jiraApi.ts', () => ({
  jiraGet: mockJiraGet,
}));

import {
  enrichIssuesWithSnowLinks,
  extractSnowLinksFromSummary,
} from './useDsuSnowEnrichment.ts';

function createIssue(key: string, summary: string): JiraIssue {
  return {
    id: key,
    key,
    fields: {
      summary,
      status: { name: 'Open', statusCategory: { key: 'new' } },
      priority: null,
      assignee: null,
      reporter: null,
      issuetype: { name: 'Bug', iconUrl: '' },
      created: '2025-01-01T00:00:00.000Z',
      updated: '2025-01-01T00:00:00.000Z',
      description: null,
    },
  };
}

describe('useDsuSnowEnrichment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('extractSnowLinksFromSummary finds unique INC and PRB values and builds URLs', () => {
    expect(
      extractSnowLinksFromSummary(
        'Investigate inc123 and PRB456 before revisiting inc123',
        'https://snow.example.com/',
      ),
    ).toEqual([
      { label: 'INC123', url: 'https://snow.example.com/incident.do?number=INC123' },
      { label: 'PRB456', url: 'https://snow.example.com/problem.do?number=PRB456' },
    ]);
  });

  it('extractSnowLinksFromSummary returns null URLs when no base URL is provided', () => {
    expect(extractSnowLinksFromSummary('Review INC789 today', '')).toEqual([
      { label: 'INC789', url: null },
    ]);
  });

  it('enrichIssuesWithSnowLinks combines summary matches with additional remote links', async () => {
    mockJiraGet.mockResolvedValueOnce([
      {
        object: {
          title: 'Primary problem PRB456',
          url: 'https://snow.example.com/problem.do?number=PRB456',
        },
      },
      {
        object: {
          title: 'Duplicate incident INC123',
          url: 'https://snow.example.com/incident.do?number=INC123',
        },
      },
    ]);

    const snowLinksMap = await enrichIssuesWithSnowLinks(
      [createIssue('TBX-1', 'Investigate INC123 immediately')],
      'https://snow.example.com',
    );

    expect(snowLinksMap['TBX-1']).toEqual([
      { label: 'INC123', url: 'https://snow.example.com/incident.do?number=INC123' },
      { label: 'PRB456', url: 'https://snow.example.com/problem.do?number=PRB456' },
    ]);
    expect(mockJiraGet).toHaveBeenCalledWith('/rest/api/2/issue/TBX-1/remotelink');
  });

  it('enrichIssuesWithSnowLinks keeps summary matches when remote-link lookups fail and limits lookups to 15 issues', async () => {
    mockJiraGet.mockRejectedValue(new Error('Remote link failure'));
    const issues = Array.from({ length: 16 }, (_, issueIndex) =>
      createIssue(`TBX-${issueIndex + 1}`, `Investigate INC${issueIndex + 1}`),
    );

    const snowLinksMap = await enrichIssuesWithSnowLinks(issues, 'https://snow.example.com');

    expect(Object.keys(snowLinksMap)).toHaveLength(16);
    expect(snowLinksMap['TBX-16']).toEqual([
      { label: 'INC16', url: 'https://snow.example.com/incident.do?number=INC16' },
    ]);
    expect(mockJiraGet).toHaveBeenCalledTimes(15);
  });
});
