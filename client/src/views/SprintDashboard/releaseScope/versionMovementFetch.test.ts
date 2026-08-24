// versionMovementFetch.test.ts — Two searches, and what happens when Jira refuses one of them.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockJiraGet } = vi.hoisted(() => ({ mockJiraGet: vi.fn() }));

vi.mock('../../../services/jiraApi.ts', () => ({ jiraGet: mockJiraGet }));

import { loadVersionMovement } from './versionMovementFetch.ts';

function issueResponse(issues: Array<{ key: string; fixVersions?: string[] }>) {
  return {
    total: issues.length,
    issues: issues.map((issue) => ({
      key: issue.key,
      fields: {
        summary: `Summary ${issue.key}`,
        status: { name: 'Working' },
        assignee: { displayName: 'Smith, Michael (CTR)' },
        fixVersions: (issue.fixVersions ?? []).map((name) => ({ name })),
      },
    })),
  };
}

beforeEach(() => vi.clearAllMocks());

describe('loadVersionMovement', () => {
  it('names the issues that left and where they went', async () => {
    // The question that prompted this: 27 issues became 15, and Jira will not say where 12 went.
    mockJiraGet
      .mockResolvedValueOnce(issueResponse([{ key: 'ENC-1', fixVersions: ['08/27/2026'] }]))
      .mockResolvedValueOnce(issueResponse([
        { key: 'ENC-1', fixVersions: ['08/27/2026'] },
        { key: 'ENC-2', fixVersions: ['08/27/2026 B (scope pushed from july)'] },
      ]));

    const outcome = await loadVersionMovement('ENCUC', '08/27/2026');

    expect(outcome.movement.departed).toHaveLength(1);
    expect(outcome.movement.departed[0].key).toBe('ENC-2');
    expect(outcome.movement.departed[0].movedToVersionNames).toEqual(['08/27/2026 B (scope pushed from july)']);
  });

  it('asks what is in the version now BEFORE asking for history', async () => {
    // The half that never fails runs first, so a refused history query still leaves something usable.
    mockJiraGet.mockResolvedValue(issueResponse([]));

    await loadVersionMovement('ENCUC', '08/27/2026');

    expect(decodeURIComponent(String(mockJiraGet.mock.calls[0][0]))).toContain('fixVersion = "08/27/2026"');
    expect(decodeURIComponent(String(mockJiraGet.mock.calls[1][0]))).toContain('fixVersion WAS "08/27/2026"');
  });

  it('says the history is UNAVAILABLE rather than reporting that nothing left', async () => {
    // An empty departures list meaning "we could not look" is indistinguishable on screen from one
    // meaning "nothing moved", and those are opposite answers.
    mockJiraGet
      .mockResolvedValueOnce(issueResponse([{ key: 'ENC-1' }]))
      .mockRejectedValueOnce(new Error("Field 'fixVersion' does not support the 'WAS' operator"));

    const outcome = await loadVersionMovement('ENCUC', '08/27/2026');

    expect(outcome.isHistoryUnavailable).toBe(true);
    expect(outcome.historyErrorMessage).toContain('WAS');
    expect(outcome.movement.departed).toEqual([]);
  });

  it('still reports what the version holds today when the history is refused', async () => {
    mockJiraGet
      .mockResolvedValueOnce(issueResponse([{ key: 'ENC-1', fixVersions: ['08/27/2026'] }]))
      .mockRejectedValueOnce(new Error('nope'));

    const outcome = await loadVersionMovement('ENCUC', '08/27/2026');

    expect(outcome.movement.arrived.map((issue) => issue.key)).toEqual(['ENC-1']);
  });

  it('reads the fields a row shows, and no more', async () => {
    mockJiraGet.mockResolvedValue(issueResponse([]));

    await loadVersionMovement('ENCUC', '08/27/2026');

    expect(String(mockJiraGet.mock.calls[0][0])).toContain('fields=summary,status,assignee,fixVersions');
  });
});
