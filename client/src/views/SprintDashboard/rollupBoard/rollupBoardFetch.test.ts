// rollupBoardFetch.test.ts — Proves the board loads EVERYTHING, and says so honestly when it cannot.
//
// The board's whole claim is that nothing is hidden. A silently short board would break that claim
// far more quietly than an error would, so these tests care as much about what is reported as about
// what is returned.

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

/** Builds a board issue with just enough shape for the fetch layer to key and count it. */
function buildIssue(key: string, extraFields: Record<string, unknown> = {}) {
  return { id: key, key, fields: { summary: key, ...extraFields } };
}

/** Builds `total` board issues named BOARD-1…BOARD-n. */
function buildIssues(total: number) {
  return Array.from({ length: total }, (_ignored, issueIndex) => buildIssue(`BOARD-${issueIndex + 1}`));
}

beforeEach(() => {
  vi.clearAllMocks();
});

/** Answers board pages from one issue list and returns empty results for every search sweep. */
function mockBoardPages(allIssues: ReturnType<typeof buildIssues>, pageSize: number) {
  mockJiraGet.mockImplementation((requestPath: string) => {
    if (requestPath.includes('/board/42/issue')) {
      const startAt = Number(/startAt=(\d+)/.exec(requestPath)?.[1] ?? 0);
      return Promise.resolve({
        total: allIssues.length,
        startAt,
        maxResults: pageSize,
        issues: allIssues.slice(startAt, startAt + pageSize),
      });
    }
    return Promise.resolve({ issues: [] });
  });
}

describe('fetchRollupBoardIssues — board sweep', () => {
  it('pages until it has every issue Jira says the board holds', async () => {
    mockBoardPages(buildIssues(250), 100);

    const issueSet = await fetchRollupBoardIssues(SCOPE);

    expect(issueSet.boardIssues).toHaveLength(250);
    expect(issueSet.load.isComplete).toBe(true);
    expect(issueSet.load.loadedBoardIssueCount).toBe(250);
    expect(issueSet.load.expectedBoardIssueCount).toBe(250);
  });

  it('fails loudly when a board page is rejected, rather than rendering what it managed to get', async () => {
    mockJiraGet.mockImplementation((requestPath: string) => {
      if (requestPath.includes('startAt=0')) {
        return Promise.resolve({ total: 250, startAt: 0, maxResults: 100, issues: buildIssues(100) });
      }
      if (requestPath.includes('/board/42/issue')) {
        return Promise.reject(new Error('Jira said no'));
      }
      return Promise.resolve({ issues: [] });
    });

    await expect(fetchRollupBoardIssues(SCOPE)).rejects.toThrow(/Jira said no/);
  });

  it('loads an oversized board in full and warns, rather than trimming it to stay fast', async () => {
    mockBoardPages(buildIssues(420), 100);

    const issueSet = await fetchRollupBoardIssues(SCOPE);

    expect(issueSet.boardIssues).toHaveLength(420);
    expect(issueSet.load.isOversized).toBe(true);
    expect(issueSet.load.isComplete).toBe(true);
  });

  it('asks for the sub-status field when this instance has one', async () => {
    mockBoardPages(buildIssues(1), 100);

    await fetchRollupBoardIssues(SCOPE);

    const boardRequestPath = mockJiraGet.mock.calls.find((call) => String(call[0]).includes('/board/42/issue'))?.[0];
    expect(decodeURIComponent(String(boardRequestPath))).toContain('customfield_10201');
  });

  it('never sends an empty field id when this instance has no sub-status field', async () => {
    mockBoardPages(buildIssues(1), 100);

    await fetchRollupBoardIssues({ ...SCOPE, subStatusFieldId: '' });

    const boardRequestPath = decodeURIComponent(
      String(mockJiraGet.mock.calls.find((call) => String(call[0]).includes('/board/42/issue'))?.[0]),
    );
    expect(boardRequestPath).not.toContain(',,');
    expect(boardRequestPath).not.toContain('fields=,');
  });
});

describe('fetchRollupBoardIssues — sub-task sweep', () => {
  it('chunks the parent sweep, because board issues never include sub-tasks', async () => {
    const boardIssues = buildIssues(120);
    mockJiraGet.mockImplementation((requestPath: string) => {
      if (requestPath.includes('/board/42/issue')) {
        return Promise.resolve({ total: 120, startAt: 0, maxResults: 200, issues: boardIssues });
      }
      return Promise.resolve({ issues: [] });
    });

    await fetchRollupBoardIssues(SCOPE);

    const parentSweepCalls = mockJiraGet.mock.calls.filter((call) => String(call[0]).includes('parent%20in'));
    expect(parentSweepCalls).toHaveLength(3);
  });

  it('reports a failed sub-task chunk instead of swallowing it, and keeps what the others returned', async () => {
    const boardIssues = buildIssues(120);
    let parentSweepCallCount = 0;
    mockJiraGet.mockImplementation((requestPath: string) => {
      if (requestPath.includes('/board/42/issue')) {
        return Promise.resolve({ total: 120, startAt: 0, maxResults: 200, issues: boardIssues });
      }
      if (requestPath.includes('parent%20in')) {
        parentSweepCallCount += 1;
        if (parentSweepCallCount === 2) {
          return Promise.reject(new Error('chunk exploded'));
        }
        return Promise.resolve({ issues: [buildIssue(`SUB-${parentSweepCallCount}`)] });
      }
      return Promise.resolve({ issues: [] });
    });

    const issueSet = await fetchRollupBoardIssues(SCOPE);

    expect(issueSet.load.isComplete).toBe(false);
    expect(issueSet.load.failures[0].stage).toBe('subtasks');
    expect(issueSet.subtaskIssues).toHaveLength(2);
  });

  it('skips the sweep entirely when the board is empty', async () => {
    mockBoardPages([], 100);

    await fetchRollupBoardIssues(SCOPE);

    expect(mockJiraGet.mock.calls.filter((call) => String(call[0]).includes('parent%20in'))).toHaveLength(0);
  });
});

describe('fetchRollupBoardIssues — feature sweep', () => {
  it('reads Features by key, so a Feature in another project resolves like any other', async () => {
    mockJiraGet.mockImplementation((requestPath: string) => {
      if (requestPath.includes('/board/42/issue')) {
        return Promise.resolve({
          total: 1,
          startAt: 0,
          maxResults: 200,
          issues: [buildIssue('BOARD-1', { customfield_10108: 'PORTFOLIO-9' })],
        });
      }
      if (requestPath.includes('key%20in')) {
        return Promise.resolve({ issues: [buildIssue('PORTFOLIO-9')] });
      }
      return Promise.resolve({ issues: [] });
    });

    const issueSet = await fetchRollupBoardIssues(SCOPE);

    expect(issueSet.featureIssues.get('PORTFOLIO-9')?.key).toBe('PORTFOLIO-9');
  });

  it('reports a failed feature chunk rather than quietly showing every Feature as unreadable', async () => {
    mockJiraGet.mockImplementation((requestPath: string) => {
      if (requestPath.includes('/board/42/issue')) {
        return Promise.resolve({
          total: 1,
          startAt: 0,
          maxResults: 200,
          issues: [buildIssue('BOARD-1', { customfield_10108: 'PORTFOLIO-9' })],
        });
      }
      if (requestPath.includes('key%20in')) {
        return Promise.reject(new Error('feature chunk exploded'));
      }
      return Promise.resolve({ issues: [] });
    });

    const issueSet = await fetchRollupBoardIssues(SCOPE);

    expect(issueSet.load.isComplete).toBe(false);
    expect(issueSet.load.failures.some((failure) => failure.stage === 'features')).toBe(true);
  });
});
