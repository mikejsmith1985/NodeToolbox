// rollupBoardFetch.test.ts — Proves the board reads exactly the work the dashboard has scoped, and
// says so honestly when part of it cannot be read.
//
// The headline behaviour is the first block: this tab must mirror the Team Dashboard's Sprint / Fix
// Version / PI selection. Querying the board filter instead returns its whole saved scope, backlog
// included, which is how the board ended up showing far more than the team had asked to see.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockJiraGet } = vi.hoisted(() => ({ mockJiraGet: vi.fn() }));

vi.mock('../../../services/jiraApi.ts', () => ({ jiraGet: mockJiraGet }));

import { fetchRollupBoardIssues } from './rollupBoardFetch.ts';
import type { RollupBoardScope } from './rollupBoardTypes.ts';

const SCOPE: RollupBoardScope = {
  boardId: 42,
  teamProfileId: 'team-a',
  featureLinkFieldId: 'customfield_10108',
  subStatusFieldId: 'customfield_10201',
  storyPointsFieldIds: ['customfield_10016'],
};

/** Builds an issue with just enough shape for the fetch layer to key and count it. */
function buildIssue(key: string, extraFields: Record<string, unknown> = {}) {
  return { id: key, key, fields: { summary: key, ...extraFields } };
}

/** Builds `total` issues named BOARD-1…BOARD-n. */
function buildIssues(total: number) {
  return Array.from({ length: total }, (_ignored, issueIndex) => buildIssue(`BOARD-${issueIndex + 1}`));
}

/** True when a request path is one of the `key in (…)` reads. */
function isKeyInRequest(requestPath: string): boolean {
  return requestPath.includes('key%20in');
}

/** The keys a `key in (…)` request actually asked for, so a mock can answer precisely. */
function readRequestedKeys(requestPath: string): string[] {
  const requested = /key in \(([^)]*)\)/.exec(decodeURIComponent(requestPath))?.[1] ?? '';
  return requested.split(',').map((key) => key.replace('ORDER BY key ASC', '').trim()).filter(Boolean);
}

/** Answers every `key in (…)` read with exactly the issues it asked for — chunking and all. */
function mockKeyInEchoesRequest(extraFieldsByKey: Record<string, Record<string, unknown>> = {}) {
  mockJiraGet.mockImplementation((requestPath: string) => {
    if (!isKeyInRequest(requestPath)) return Promise.resolve({ issues: [] });
    return Promise.resolve({
      issues: readRequestedKeys(requestPath).map((key) => buildIssue(key, extraFieldsByKey[key] ?? {})),
    });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('fetchRollupBoardIssues — it mirrors the dashboard\'s scope', () => {
  it('reads exactly the issues the dashboard scoped, and never queries the board filter', async () => {
    mockJiraGet.mockImplementation((requestPath: string) =>
      isKeyInRequest(requestPath)
        ? Promise.resolve({ issues: [buildIssue('BOARD-1'), buildIssue('BOARD-2')] })
        : Promise.resolve({ issues: [] }));

    const issueSet = await fetchRollupBoardIssues(SCOPE, ['BOARD-1', 'BOARD-2']);

    expect(issueSet.boardIssues.map((issue) => issue.key)).toEqual(['BOARD-1', 'BOARD-2']);
    // Querying /board/{id}/issue would drag in the whole backlog, ignoring sprint and PI.
    expect(mockJiraGet.mock.calls.some((call) => String(call[0]).includes('/board/'))).toBe(false);
  });

  it('measures completeness against the scope it was given', async () => {
    mockJiraGet.mockImplementation((requestPath: string) =>
      isKeyInRequest(requestPath)
        ? Promise.resolve({ issues: [buildIssue('BOARD-1')] })
        : Promise.resolve({ issues: [] }));

    const issueSet = await fetchRollupBoardIssues(SCOPE, ['BOARD-1']);

    expect(issueSet.load.expectedBoardIssueCount).toBe(1);
    expect(issueSet.load.isComplete).toBe(true);
  });

  it('chunks a large scope rather than sending one unbounded request', async () => {
    mockJiraGet.mockResolvedValue({ issues: [] });

    await fetchRollupBoardIssues(SCOPE, buildIssues(120).map((issue) => issue.key));

    expect(mockJiraGet.mock.calls.filter((call) => isKeyInRequest(String(call[0])))).toHaveLength(3);
  });

  it('does nothing at all when the dashboard\'s scope is empty', async () => {
    mockJiraGet.mockResolvedValue({ issues: [] });

    const issueSet = await fetchRollupBoardIssues(SCOPE, []);

    expect(issueSet.boardIssues).toEqual([]);
    expect(mockJiraGet).not.toHaveBeenCalled();
  });

  it('fails loudly when the scoped read is rejected, rather than rendering a partial board', async () => {
    mockJiraGet.mockRejectedValue(new Error('Jira said no'));

    await expect(fetchRollupBoardIssues(SCOPE, ['BOARD-1'])).rejects.toThrow(/Jira said no/);
  });

  it('warns about an oversized scope while still returning all of it', async () => {
    mockJiraGet.mockImplementation((requestPath: string) =>
      isKeyInRequest(requestPath) ? Promise.resolve({ issues: buildIssues(420) }) : Promise.resolve({ issues: [] }));

    const issueSet = await fetchRollupBoardIssues(SCOPE, buildIssues(420).map((issue) => issue.key));

    expect(issueSet.load.isOversized).toBe(true);
  });

  it('asks for the sub-status field when this instance has one', async () => {
    mockJiraGet.mockResolvedValue({ issues: [] });

    await fetchRollupBoardIssues(SCOPE, ['BOARD-1']);

    expect(decodeURIComponent(String(mockJiraGet.mock.calls[0][0]))).toContain('customfield_10201');
  });

  it('never sends an empty field id when this instance has no sub-status field', async () => {
    mockJiraGet.mockResolvedValue({ issues: [] });

    await fetchRollupBoardIssues({ ...SCOPE, subStatusFieldId: '' }, ['BOARD-1']);

    const requestPath = decodeURIComponent(String(mockJiraGet.mock.calls[0][0]));
    expect(requestPath).not.toContain(',,');
    expect(requestPath).not.toContain('fields=,');
  });
});

describe('fetchRollupBoardIssues — sub-task sweep', () => {
  it('chunks the parent sweep, because a Jira board never returns sub-tasks', async () => {
    const scopedIssues = buildIssues(120);
    mockKeyInEchoesRequest();

    await fetchRollupBoardIssues(SCOPE, scopedIssues.map((issue) => issue.key));

    expect(mockJiraGet.mock.calls.filter((call) => String(call[0]).includes('parent%20in'))).toHaveLength(3);
  });

  it('reports a failed sub-task chunk instead of swallowing it, and keeps what the others returned', async () => {
    const scopedIssues = buildIssues(120);
    let parentSweepCallCount = 0;
    mockJiraGet.mockImplementation((requestPath: string) => {
      if (isKeyInRequest(requestPath)) {
        return Promise.resolve({ issues: readRequestedKeys(requestPath).map((key) => buildIssue(key)) });
      }
      if (requestPath.includes('parent%20in')) {
        parentSweepCallCount += 1;
        return parentSweepCallCount === 2
          ? Promise.reject(new Error('chunk exploded'))
          : Promise.resolve({ issues: [buildIssue(`SUB-${parentSweepCallCount}`)] });
      }
      return Promise.resolve({ issues: [] });
    });

    const issueSet = await fetchRollupBoardIssues(SCOPE, scopedIssues.map((issue) => issue.key));

    expect(issueSet.load.isComplete).toBe(false);
    expect(issueSet.load.failures[0].stage).toBe('subtasks');
    expect(issueSet.subtaskIssues).toHaveLength(2);
  });

  it('skips the sweep entirely when the scope is empty', async () => {
    mockJiraGet.mockResolvedValue({ issues: [] });

    await fetchRollupBoardIssues(SCOPE, []);

    expect(mockJiraGet.mock.calls.filter((call) => String(call[0]).includes('parent%20in'))).toHaveLength(0);
  });
});

describe('fetchRollupBoardIssues — feature sweep', () => {
  it('reads Features by key, so a Feature in another project resolves like any other', async () => {
    mockKeyInEchoesRequest({ 'BOARD-1': { customfield_10108: 'PORTFOLIO-9' } });

    const issueSet = await fetchRollupBoardIssues(SCOPE, ['BOARD-1']);

    expect(issueSet.featureIssues.get('PORTFOLIO-9')?.key).toBe('PORTFOLIO-9');
  });

  it('reports a failed feature chunk rather than quietly showing every Feature as unreadable', async () => {
    let keyInCallCount = 0;
    mockJiraGet.mockImplementation((requestPath: string) => {
      if (!isKeyInRequest(requestPath)) return Promise.resolve({ issues: [] });
      keyInCallCount += 1;
      // The scoped detail read succeeds; the Feature sweep that follows it fails.
      return keyInCallCount === 1
        ? Promise.resolve({ issues: [buildIssue('BOARD-1', { customfield_10108: 'PORTFOLIO-9' })] })
        : Promise.reject(new Error('feature chunk exploded'));
    });

    const issueSet = await fetchRollupBoardIssues(SCOPE, ['BOARD-1']);

    expect(issueSet.load.isComplete).toBe(false);
    expect(issueSet.load.failures.some((failure) => failure.stage === 'features')).toBe(true);
  });
});
