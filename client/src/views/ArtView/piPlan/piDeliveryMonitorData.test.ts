// piDeliveryMonitorData.test.ts — Pure monitor adapters: plan → written snapshot, live rows → live snapshot.

import { describe, expect, it } from 'vitest';

import { planToWrittenSnapshot, summarizeLiveRows, deriveSubtaskSignals, parseSprintName, type LiveStoryRow } from './piDeliveryMonitorData.ts';
import { computeMonitor } from './piPlanMonitor.ts';
import type { DeliveryPlan, PlannedStory } from './piDeliveryEngine.ts';
import type { PiPlanningFactSheet } from './piPlanTypes.ts';

function story(summary: string, sprintName: string, sizePoints: number): PlannedStory {
  return {
    tempId: `${summary}#1`, featureKey: 'DENP-1', summary, sizePoints, codingSubtasks: [], slAssignee: null,
    sprintName, dates: { targetStartIso: '', internalTestEndIso: null, targetEndIso: '', deployIntIso: '', deployRelIso: '', deployProdIso: null, dueIso: null, derivations: {} },
    warnings: [],
  };
}

function factSheet(): PiPlanningFactSheet {
  return {
    piName: '26.4', piStartIso: '2026-07-30', deliveryDeadlineIso: '2026-09-30', features: [],
    people: [
      { displayName: 'Dev', accountId: 'a1', roles: ['dev'], pointsPerSprint: 8 },
      { displayName: 'SL', accountId: 'a2', roles: ['internalTest'], pointsPerSprint: 6 },
    ],
    sprints: [
      { name: 'S1', startIso: '2026-07-30', endIso: '2026-08-12' },
      { name: 'S2', startIso: '2026-08-13', endIso: '2026-08-26' },
    ],
    releaseSchedule: { entries: [] }, repoAllowlist: [], fieldConfig: { inIntStatusNames: [], slDoneStatusNames: [], doneCategoryNames: [] },
    velocityByPerson: {}, notes: [],
  };
}

const plan: DeliveryPlan = {
  stories: [story('Alpha', 'S1', 5), story('Beta', 'S1', 3), story('Gamma', 'S2', 8)],
  planResult: { sprints: [], proposals: [], bottleneck: { limitingRole: null, additionalToMatchThroughput: 0, additionalToFinishByPiEnd: 0, statement: '' }, completionSprintIndex: 1, completionDateIso: null, sprintsBeyondPiEnd: 0, unschedulableItemKeys: [] },
  honestStates: [],
};

describe('planToWrittenSnapshot', () => {
  it('sums planned points per sprint and carries SL capacity + planned sprint per story', () => {
    const snapshot = planToWrittenSnapshot(plan, factSheet());
    expect(snapshot.sprints.find((s) => s.name === 'S1')?.plannedPoints).toBe(8); // 5 + 3
    expect(snapshot.sprints.find((s) => s.name === 'S2')?.plannedPoints).toBe(8);
    expect(snapshot.sprints[0].slCapacity).toBe(6); // one SL person, 6 pts
    expect(snapshot.stories.find((s) => s.key === 'Gamma')?.plannedSprint).toBe('S2');
  });
});

describe('summarizeLiveRows', () => {
  const written = planToWrittenSnapshot(plan, factSheet());

  function rows(): LiveStoryRow[] {
    return [
      { storyKey: 'Alpha', sprintName: 'S1', points: 5, isDone: true, isSlQueued: false, subtaskAgingDays: 2, lastActivityIso: '2026-08-01' },
      { storyKey: 'Beta', sprintName: 'S1', points: 3, isDone: false, isSlQueued: true, subtaskAgingDays: 7, lastActivityIso: '2026-08-05' },
      { storyKey: 'Gamma', sprintName: 'S2', points: 8, isDone: false, isSlQueued: false, subtaskAgingDays: 1, lastActivityIso: '2026-08-14' },
    ];
  }

  it('aggregates per-sprint completed points, SL queue, and committed vs completed', () => {
    const live = summarizeLiveRows(rows(), written);
    const s1 = live.sprints.find((s) => s.name === 'S1')!;
    expect(s1.completedPoints).toBe(5);
    expect(s1.slQueueDepth).toBe(1);
    expect(s1.committedStories).toBe(2);
    expect(s1.completedStories).toBe(1);
    expect(live.maxSubtaskAgingDays).toBe(7);
  });

  it('feeds computeMonitor to produce coherent signals + triggers', () => {
    const live = summarizeLiveRows(rows(), written);
    const result = computeMonitor(written, live, '2026-08-20');
    expect(result.signals.some((s) => s.kind === 'burnUp')).toBe(true);
    // Beta's aging (7) exceeds the target → sub-task-aging off track.
    expect(result.signals.find((s) => s.kind === 'subtaskAging')?.isOnTrack).toBe(false);
  });

  it('records the actual sprint per story for slip detection', () => {
    const slipRows = rows().map((row) => (row.storyKey === 'Gamma' ? { ...row, sprintName: 'S2' } : row));
    const live = summarizeLiveRows(slipRows, written);
    expect(live.actualSprintByStory['Gamma']).toBe('S2');
  });
});

describe('deriveSubtaskSignals', () => {
  it('ages by the oldest IN-PROGRESS sub-task and flags a not-done SL sub-task as queued', () => {
    const signals = deriveSubtaskSignals([
      { summary: '[api] Story', statusCategoryKey: 'indeterminate', updatedIso: '2026-08-13' },
      { summary: '[SL] SL Test — Story', statusCategoryKey: 'new', updatedIso: '2026-08-19' },
      { summary: '[INT] Deploy — Story', statusCategoryKey: 'new', updatedIso: '2026-08-19' },
    ], '2026-08-20');
    expect(signals.agingDays).toBe(7);     // api coding sub-task in progress since 08-13
    expect(signals.isSlQueued).toBe(true); // SL sub-task exists and is not done
  });

  it('is not queued when the SL sub-task is done, and ages 0 with nothing in progress', () => {
    const signals = deriveSubtaskSignals([
      { summary: '[api] Story', statusCategoryKey: 'done', updatedIso: '2026-08-10' },
      { summary: '[SL] SL Test — Story', statusCategoryKey: 'done', updatedIso: '2026-08-12' },
    ], '2026-08-20');
    expect(signals.agingDays).toBe(0);
    expect(signals.isSlQueued).toBe(false);
  });

  it('is not queued when there is no SL sub-task at all', () => {
    expect(deriveSubtaskSignals([{ summary: '[api] Story', statusCategoryKey: 'indeterminate', updatedIso: '2026-08-19' }], '2026-08-20').isSlQueued).toBe(false);
  });
});

describe('parseSprintName', () => {
  it('reads the newest sprint name from the legacy greenhopper string', () => {
    expect(parseSprintName(['com.atlassian.greenhopper[id=42,state=CLOSED,name=26.4.1,goal=]', 'com.atlassian.greenhopper[id=43,state=ACTIVE,name=26.4.2,goal=]'])).toBe('26.4.2');
  });

  it('reads a modern object array and returns null when absent', () => {
    expect(parseSprintName([{ name: '26.4.3' }])).toBe('26.4.3');
    expect(parseSprintName(null)).toBeNull();
    expect(parseSprintName([])).toBeNull();
  });
});
