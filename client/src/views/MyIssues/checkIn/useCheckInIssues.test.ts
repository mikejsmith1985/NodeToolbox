// useCheckInIssues.test.ts — Fetching one person's plate, with the fields a check-in needs.

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockJiraGet } = vi.hoisted(() => ({ mockJiraGet: vi.fn() }));

vi.mock('../../../services/jiraApi.ts', () => ({ jiraGet: mockJiraGet }));

import { useCheckInIssues } from './useCheckInIssues.ts';
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
