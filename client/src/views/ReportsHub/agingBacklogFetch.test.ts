// agingBacklogFetch.test.ts — Verifies the shared enriched backlog fetch: it queries NOT-Done issues, pages
// them, and projects each into the triage shape with the instance-correct signals (dropdown story points,
// time-in-status, ownership), while also returning the lighter inputs the aging metrics engine needs.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// One mock for the Jira client, routed by request path.
const { mockJiraGet } = vi.hoisted(() => ({ mockJiraGet: vi.fn() }));

vi.mock('../../services/jiraApi.ts', () => ({
  jiraGet: mockJiraGet,
}));

import { fetchAgingBacklog } from './agingBacklogFetch.ts';

const TODAY = '2026-07-13';

/** A raw NOT-Done issue with a dropdown story-points field and a status-category-change date. */
function rawIssue(key: string, overrides: Record<string, unknown> = {}) {
  return {
    key,
    fields: {
      issuetype: { name: 'Story' },
      created: '2026-01-01T00:00:00.000Z',
      status: { name: 'To Do' },
      updated: '2026-05-01T00:00:00.000Z',
      statuscategorychangedate: '2026-03-01T00:00:00.000Z',
      summary: `Summary ${key}`,
      priority: { name: 'Low' },
      assignee: { displayName: 'Jane Dev' },
      description: 'has text',
      // Dropdown story-points field (this instance's default) — the object Jira returns for a select field.
      customfield_10236: { value: '5' },
      ...overrides,
    },
  };
}

describe('fetchAgingBacklog', () => {
  beforeEach(() => {
    mockJiraGet.mockReset();
    localStorage.clear();
    mockJiraGet.mockImplementation((path: string) => {
      const requestPath = String(path);
      // The instance field list (for Acceptance-Criteria resolution) — none, so AC falls back to the default id.
      if (requestPath.includes('/rest/api/2/field')) {
        return Promise.resolve([]);
      }
      // The backlog search — one full page, no further pages.
      if (requestPath.includes('/rest/api/2/search')) {
        return Promise.resolve({ issues: [rawIssue('ENCUC-1'), rawIssue('ENCUC-2')], total: 2 });
      }
      return Promise.resolve({ issues: [] });
    });
  });

  afterEach(() => localStorage.clear());

  it('queries NOT-Done issues wrapped by the scope and oldest-first', async () => {
    await fetchAgingBacklog('project = ENCUC', TODAY);
    const searchPath = mockJiraGet.mock.calls
      .map(([path]) => decodeURIComponent(String(path)))
      .find((path) => path.includes('/rest/api/2/search')) as string;
    expect(searchPath).toContain('(project = ENCUC) AND statusCategory != Done ORDER BY created ASC');
  });

  it('projects each issue into the triage shape with the dropdown story points and time-in-status', async () => {
    const result = await fetchAgingBacklog('project = ENCUC', TODAY);
    expect(result.triageIssues).toHaveLength(2);
    const first = result.triageIssues[0];
    expect(first.issueKey).toBe('ENCUC-1');
    expect(first.storyPoints).toBe(5); // dropdown { value: '5' } unwrapped via the shared reader
    expect(first.assignee).toBe('Jane Dev');
    expect(first.daysInStatus).toBeGreaterThan(0); // statuscategorychangedate was read
    expect(first.hasDescription).toBe(true);
  });

  it('also returns the lighter aging inputs and the issues-by-key map', async () => {
    const result = await fetchAgingBacklog('project = ENCUC', TODAY);
    expect(result.agingInputs.map((input) => input.key)).toEqual(['ENCUC-1', 'ENCUC-2']);
    expect(result.issuesByKey.get('ENCUC-2')).toBeDefined();
    expect(result.wasCapped).toBe(false);
    expect(result.jql).toContain('statusCategory != Done');
  });
});
