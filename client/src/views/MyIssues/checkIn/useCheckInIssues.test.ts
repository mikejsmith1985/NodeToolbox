// useCheckInIssues.test.ts — Fetching one person's plate, with the fields a check-in needs.

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockJiraGet } = vi.hoisted(() => ({ mockJiraGet: vi.fn() }));

vi.mock('../../../services/jiraApi.ts', () => ({ jiraGet: mockJiraGet }));

import { buildCheckInJql, useCheckInIssues } from './useCheckInIssues.ts';
import { FEATURE_LINK_DEFAULT_FIELD } from '../../../utils/featureLink.ts';
import type { ReportSubject } from '../myIssuesRoleLens.ts';

const SIMULATED_USER: ReportSubject = {
  kind: 'user',
  accountId: '557058:ab-12',
  displayName: 'Reynolds, Kevin',
};

/** The URL of the nth jiraGet call. */
function requestedUrl(callIndex: number): string {
  return String(mockJiraGet.mock.calls[callIndex][0]);
}

/** One Jira issue, carrying only what the hook reads. */
function jiraIssue(key: string, fields: Record<string, unknown> = {}) {
  return {
    key,
    fields: {
      summary: `Summary for ${key}`,
      issuetype: { name: 'Story' },
      status: { name: 'In Progress' },
      updated: '2026-08-25T00:00:00.000Z',
      statuscategorychangedate: '2026-08-18T00:00:00.000Z',
      ...fields,
    },
  };
}

describe('useCheckInIssues', () => {
  beforeEach(() => {
    mockJiraGet.mockReset();
  });

  it('asks for the work of whoever the persona picker is pointed at', async () => {
    mockJiraGet.mockResolvedValue({ issues: [] });

    renderHook(() => useCheckInIssues(SIMULATED_USER, []));

    await waitFor(() => expect(mockJiraGet).toHaveBeenCalled());
    expect(decodeURIComponent(requestedUrl(0))).toContain('assignee = "557058:ab-12"');
  });

  it('asks only for open work, because a check-in is about what is live', async () => {
    mockJiraGet.mockResolvedValue({ issues: [] });

    renderHook(() => useCheckInIssues({ kind: 'viewer' }, []));

    await waitFor(() => expect(mockJiraGet).toHaveBeenCalled());
    expect(decodeURIComponent(requestedUrl(0))).toContain('statusCategory != Done');
  });

  it('asks for the fields a status conversation actually needs', async () => {
    mockJiraGet.mockResolvedValue({ issues: [] });

    renderHook(() => useCheckInIssues({ kind: 'viewer' }, []));

    await waitFor(() => expect(mockJiraGet).toHaveBeenCalled());
    const url = requestedUrl(0);
    expect(url).toContain('duedate');
    expect(url).toContain('statuscategorychangedate');
    expect(url).toContain('comment');
    expect(url).toContain(FEATURE_LINK_DEFAULT_FIELD);
  });

  it('fetches the Feature summaries so a check-in can name an outcome', async () => {
    mockJiraGet
      .mockResolvedValueOnce({ issues: [jiraIssue('ENCUC-1', { [FEATURE_LINK_DEFAULT_FIELD]: 'FEAT-10' })] })
      .mockResolvedValueOnce({ issues: [{ key: 'FEAT-10', fields: { summary: 'Online enrollment intake' } }] });

    const { result } = renderHook(() => useCheckInIssues({ kind: 'viewer' }, []));

    await waitFor(() => expect(result.current.issues).toHaveLength(1));
    expect(result.current.issues[0].featureSummary).toBe('Online enrollment intake');
  });

  it('does not ask about Features when nothing on the plate has one', async () => {
    mockJiraGet.mockResolvedValue({ issues: [jiraIssue('ENCUC-1')] });

    const { result } = renderHook(() => useCheckInIssues({ kind: 'viewer' }, []));

    await waitFor(() => expect(result.current.issues).toHaveLength(1));
    expect(mockJiraGet).toHaveBeenCalledTimes(1);
  });

  it('keeps the plate when the Feature lookup fails, losing only the wording', async () => {
    mockJiraGet
      .mockResolvedValueOnce({ issues: [jiraIssue('ENCUC-1', { [FEATURE_LINK_DEFAULT_FIELD]: 'FEAT-10' })] })
      .mockRejectedValueOnce(new Error('Jira is unreachable'));

    const { result } = renderHook(() => useCheckInIssues({ kind: 'viewer' }, []));

    await waitFor(() => expect(result.current.issues).toHaveLength(1));
    expect(result.current.issues[0].featureKey).toBe('FEAT-10');
    expect(result.current.issues[0].featureSummary).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('puts what is overdue first', async () => {
    mockJiraGet.mockResolvedValue({
      issues: [
        jiraIssue('ENCUC-1', { statuscategorychangedate: '2026-01-01T00:00:00.000Z' }),
        jiraIssue('ENCUC-2', { duedate: '2020-01-01' }),
      ],
    });

    const { result } = renderHook(() => useCheckInIssues({ kind: 'viewer' }, []));

    await waitFor(() => expect(result.current.issues).toHaveLength(2));
    expect(result.current.issues[0].issueKey).toBe('ENCUC-2');
  });

  it('says plainly when the fetch failed, rather than showing an empty plate as a fact', async () => {
    mockJiraGet.mockRejectedValue(new Error('Jira is unreachable'));

    const { result } = renderHook(() => useCheckInIssues({ kind: 'viewer' }, []));

    await waitFor(() => expect(result.current.error).toBe('Jira is unreachable'));
    expect(result.current.issues).toEqual([]);
  });
});

// ── A custom set, not just a person (GH #376) ──────────────────────────────

describe('buildCheckInJql', () => {
  it('checks in on the person when no query was given', () => {
    expect(buildCheckInJql('assignee = currentUser()', ''))
      .toBe('assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC');
  });

  it('REPLACES the person with the query rather than narrowing to both', () => {
    // "Every defect in the project" is not a subset of one person's work, and anding the two would
    // silently return nothing whenever they did not overlap.
    const jql = buildCheckInJql('assignee = currentUser()', 'project = ENCUC AND issuetype = Defect');

    expect(jql).not.toContain('assignee');
    expect(jql).toContain('project = ENCUC AND issuetype = Defect');
  });

  it('brackets the query so an OR inside it cannot escape the open-work filter', () => {
    // Without it, "a OR b AND statusCategory != Done" returns every issue matching a, closed included.
    expect(buildCheckInJql('assignee = currentUser()', 'project = A OR project = B'))
      .toBe('(project = A OR project = B) AND statusCategory != Done ORDER BY updated DESC');
  });

  it('keeps the open-work filter whichever way it was scoped', () => {
    expect(buildCheckInJql('assignee = currentUser()', 'issuetype = Defect'))
      .toContain('statusCategory != Done');
  });

  it('ignores whitespace somebody left in the box', () => {
    expect(buildCheckInJql('assignee = currentUser()', '   ')).toContain('assignee = currentUser()');
  });
});

describe('useCheckInIssues — a custom query', () => {
  beforeEach(() => {
    mockJiraGet.mockReset();
  });

  it('asks Jira for the custom set instead of the person', async () => {
    mockJiraGet.mockResolvedValue({ issues: [] });

    renderHook(() => useCheckInIssues(SIMULATED_USER, [], '', 'project = ENCUC AND issuetype = Defect'));

    await waitFor(() => expect(mockJiraGet).toHaveBeenCalled());
    // The JQL only: "assignee" also appears in the requested FIELDS, which is not the scope.
    const jql = decodeURIComponent(requestedUrl(0).split('jql=')[1].split('&')[0]);

    expect(jql).toContain('project = ENCUC AND issuetype = Defect');
    expect(jql).not.toContain('assignee');
  });

  it('goes back to the person when the query is cleared', async () => {
    mockJiraGet.mockResolvedValue({ issues: [] });

    renderHook(() => useCheckInIssues(SIMULATED_USER, [], '', ''));

    await waitFor(() => expect(mockJiraGet).toHaveBeenCalled());
    expect(decodeURIComponent(requestedUrl(0))).toContain('assignee = "557058:ab-12"');
  });
});
