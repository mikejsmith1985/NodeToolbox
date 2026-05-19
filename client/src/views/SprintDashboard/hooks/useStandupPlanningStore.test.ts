// useStandupPlanningStore.test.ts — Tests for the persisted daily standup planning store.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useStandupPlanningStore } from './useStandupPlanningStore.ts';

describe('useStandupPlanningStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useStandupPlanningStore.setState({ planEntries: [] });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-18T12:00:00.000Z'));
  });

  it('toggles issue keys inside one per-day per-scope person plan entry', () => {
    useStandupPlanningStore.getState().togglePlannedIssueKey('2026-05-18', 'sprint', 'TBX', 'Alice Adams', 'TBX-1');
    useStandupPlanningStore.getState().togglePlannedIssueKey('2026-05-18', 'sprint', 'TBX', 'Alice Adams', 'TBX-2');

    expect(useStandupPlanningStore.getState().planEntries).toEqual([
      {
        date: '2026-05-18',
        scopeMode: 'sprint',
        projectKey: 'TBX',
        personName: 'Alice Adams',
        plannedIssueKeys: ['TBX-1', 'TBX-2'],
        updatedAtIso: '2026-05-18T12:00:00.000Z',
      },
    ]);
  });

  it('removes the entry entirely when the last planned key is toggled off', () => {
    useStandupPlanningStore.getState().togglePlannedIssueKey('2026-05-18', 'roster', 'TBX', 'Alice Adams', 'TBX-1');
    useStandupPlanningStore.getState().togglePlannedIssueKey('2026-05-18', 'roster', 'TBX', 'Alice Adams', 'TBX-1');

    expect(useStandupPlanningStore.getState().planEntries).toEqual([]);
    expect(localStorage.getItem('tbxSprintDashboardStandupPlanning')).toBe('{"planEntries":[]}');
  });
});
