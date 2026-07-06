// fetchTeamVelocity.test.ts — Verifies average velocity over recent closed sprints, excluding
// work added mid-sprint, with a null fallback when there is no closed-sprint history.

import { describe, expect, it, vi } from 'vitest';

const { mockJiraGet } = vi.hoisted(() => ({ mockJiraGet: vi.fn() }));
vi.mock('../../services/jiraApi.ts', () => ({ jiraGet: mockJiraGet }));

import { fetchTeamVelocity } from './fetchTeamVelocity.ts';

describe('fetchTeamVelocity', () => {
  it('averages completed committed points across the recent closed sprints', () => {
    mockJiraGet.mockImplementation((path: string) => {
      if (path.includes('/sprint?state=closed')) {
        return Promise.resolve({ isLast: true, values: [
          { id: 1, name: 'S1', startDate: '2026-01-01' },
          { id: 2, name: 'S2', startDate: '2026-02-01' },
        ] });
      }
      if (path.includes('sprintId=1')) {
        return Promise.resolve({ contents: { completedIssues: [
          { key: 'A', currentEstimateStatistic: { statFieldValue: { value: 5 } } },
          { key: 'B', currentEstimateStatistic: { statFieldValue: { value: 3 } } },
        ], issueKeysAddedDuringSprint: {} } }); // 8 pts
      }
      // Sprint 2: D was added mid-sprint, so it does NOT count toward committed-completed velocity.
      return Promise.resolve({ contents: { completedIssues: [
        { key: 'C', currentEstimateStatistic: { statFieldValue: { value: 8 } } },
        { key: 'D', currentEstimateStatistic: { statFieldValue: { value: 2 } } },
      ], issueKeysAddedDuringSprint: { D: true } } }); // 8 pts
    });

    return fetchTeamVelocity(10, 6).then((velocity) => {
      expect(velocity).toBe(8); // (8 + 8) / 2
    });
  });

  it('returns null when the board has no closed sprints (caller falls back to the manual value)', () => {
    mockJiraGet.mockResolvedValue({ isLast: true, values: [] });
    return fetchTeamVelocity(10, 6).then((velocity) => {
      expect(velocity).toBeNull();
    });
  });
});
