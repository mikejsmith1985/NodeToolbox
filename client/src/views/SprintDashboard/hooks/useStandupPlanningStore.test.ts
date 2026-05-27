// useStandupPlanningStore.test.ts — Tests for the persisted daily standup planning store.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useStandupPlanningStore } from './useStandupPlanningStore.ts';

const TEST_STORAGE_KEY = 'tbxSprintDashboardStandupPlanning:legacy-default';

describe('useStandupPlanningStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useStandupPlanningStore.setState({
      dashboardTeamProfileId: 'legacy-default',
      planEntries: [],
    });
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
    expect(localStorage.getItem(TEST_STORAGE_KEY)).toBe('{"planEntries":[]}');
  });

  it('migrates the bare legacy standup plan entries into the first scoped team key', () => {
    localStorage.setItem('tbxSprintDashboardStandupPlanning', JSON.stringify({
      planEntries: [
        {
          date: '2026-05-18',
          scopeMode: 'sprint',
          projectKey: 'TBX',
          personName: 'Legacy Person',
          plannedIssueKeys: ['TBX-1'],
          updatedAtIso: '2026-05-17T12:00:00.000Z',
        },
      ],
    }));

    useStandupPlanningStore.getState().setDashboardTeamProfileId('team-alpha');

    expect(useStandupPlanningStore.getState().planEntries).toHaveLength(1);
    expect(localStorage.getItem('tbxSprintDashboardStandupPlanning:team-alpha')).toBe(JSON.stringify({
      planEntries: [
        {
          date: '2026-05-18',
          scopeMode: 'sprint',
          projectKey: 'TBX',
          personName: 'Legacy Person',
          plannedIssueKeys: ['TBX-1'],
          updatedAtIso: '2026-05-17T12:00:00.000Z',
        },
      ],
    }));
  });

  it('does not let a new team inherit the bare legacy standup plan entries after scoped data exists', () => {
    localStorage.setItem('tbxSprintDashboardStandupPlanning', JSON.stringify({
      planEntries: [
        {
          date: '2026-05-18',
          scopeMode: 'sprint',
          projectKey: 'TBX',
          personName: 'Legacy Person',
          plannedIssueKeys: ['TBX-1'],
          updatedAtIso: '2026-05-17T12:00:00.000Z',
        },
      ],
    }));
    localStorage.setItem('tbxSprintDashboardStandupPlanning:team-alpha', JSON.stringify({
      planEntries: [],
    }));

    useStandupPlanningStore.getState().setDashboardTeamProfileId('team-beta');

    expect(useStandupPlanningStore.getState().planEntries).toEqual([]);
  });
});
