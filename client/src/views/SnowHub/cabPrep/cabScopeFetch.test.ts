// cabScopeFetch.test.ts — Loading the Jira context, and saying what could not be found.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockJiraGet } = vi.hoisted(() => ({ mockJiraGet: vi.fn() }));

vi.mock('../../../services/jiraApi.ts', () => ({ jiraGet: mockJiraGet }));

import { loadCabScopeIssues } from './cabScopeFetch.ts';

function issueResult(key: string, overrides: Record<string, unknown> = {}) {
  return {
    key,
    fields: {
      summary: `Summary ${key}`,
      issuetype: { name: 'Story' },
      status: { name: 'Done', statusCategory: { key: 'done' } },
      assignee: { displayName: 'Ramirez, Dana' },
      ...overrides,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockJiraGet.mockResolvedValue({ issues: [] });
});

describe('loadCabScopeIssues', () => {
  it('reads the whole list in ONE search', async () => {
    // Thirty issues would otherwise cost thirty round trips before the pack could be prompted for.
    mockJiraGet.mockResolvedValue({ issues: [issueResult('ENCUC-1'), issueResult('ENCUC-2')] });

    await loadCabScopeIssues(['ENCUC-1', 'ENCUC-2']);

    expect(mockJiraGet).toHaveBeenCalledTimes(1);
    expect(decodeURIComponent(String(mockJiraGet.mock.calls[0][0]))).toContain('key in ("ENCUC-1","ENCUC-2")');
  });

  it('reduces each issue to what a CAB question can be asked about', async () => {
    mockJiraGet.mockResolvedValue({ issues: [issueResult('ENCUC-1')] });

    const outcome = await loadCabScopeIssues(['ENCUC-1']);

    expect(outcome.issues[0]).toMatchObject({
      key: 'ENCUC-1',
      issueType: 'Story',
      status: 'Done',
      assignee: 'Ramirez, Dana',
      isComplete: true,
    });
  });

  it('names keys Jira did not return', async () => {
    // A key in a description can be a typo, a deleted issue, or a project the operator cannot see —
    // and a pack built from twenty-eight of thirty answers "is everything finished?" from an
    // incomplete picture.
    mockJiraGet.mockResolvedValue({ issues: [issueResult('ENCUC-1')] });

    const outcome = await loadCabScopeIssues(['ENCUC-1', 'ENCUC-404']);

    expect(outcome.missingKeys).toEqual(['ENCUC-404']);
  });

  it('marks work that is not finished', async () => {
    mockJiraGet.mockResolvedValue({
      issues: [issueResult('ENCUC-1', { status: { name: 'Working', statusCategory: { key: 'indeterminate' } } })],
    });

    const outcome = await loadCabScopeIssues(['ENCUC-1']);

    expect(outcome.issues[0].isComplete).toBe(false);
  });

  it('reads an unassigned issue as unassigned rather than blank', async () => {
    mockJiraGet.mockResolvedValue({ issues: [issueResult('ENCUC-1', { assignee: null })] });

    const outcome = await loadCabScopeIssues(['ENCUC-1']);

    expect(outcome.issues[0].assignee).toBeNull();
  });

  it('asks for the story-points field the resolver names, never a hard-coded one', async () => {
    await loadCabScopeIssues(['ENCUC-1']);

    const requestedPath = decodeURIComponent(String(mockJiraGet.mock.calls[0][0]));
    expect(requestedPath).toContain('summary,status,issuetype,assignee');
    // Whatever this instance resolves to is in the field list beside them.
    expect(requestedPath.split('fields=')[1].length).toBeGreaterThan('summary,status,issuetype,assignee'.length);
  });

  it('costs no request for an empty scope', async () => {
    // `key in ()` is a syntax error, not an empty answer — and a change with no Jira work is real.
    const outcome = await loadCabScopeIssues([]);

    expect(mockJiraGet).not.toHaveBeenCalled();
    expect(outcome).toEqual({ issues: [], missingKeys: [] });
  });
});
