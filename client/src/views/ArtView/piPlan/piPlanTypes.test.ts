// piPlanTypes.test.ts — Compile-time shape guard for the shared plan contracts. These are type-only
// declarations, so the value of the test is that the sample literals below must satisfy the interfaces
// (a type regression fails the build); the runtime assertions confirm the sample values.

import { describe, expect, it } from 'vitest';

import type { DatedItem, PlanItemProposal, ScheduledStory, WorkingCalendar } from './piPlanTypes.ts';

describe('piPlanTypes shapes', () => {
  it('accepts a well-formed WorkingCalendar and DatedItem', () => {
    const calendar: WorkingCalendar = { weekendDays: [0, 6], holidayIsoDates: ['2026-12-25'] };
    const dates: DatedItem = {
      targetStartIso: '2026-05-21', internalTestEndIso: '2026-05-27', targetEndIso: '2026-05-28',
      deployIntIso: '2026-05-28', deployRelIso: '2026-06-04', deployProdIso: '2026-06-15', dueIso: '2026-06-15', derivations: {},
    };
    // Invariant that the date engine guarantees (analyze D1).
    expect(dates.deployIntIso).toBe(dates.targetEndIso);
    expect(calendar.weekendDays).toContain(6);
  });

  it('accepts a story PlanItemProposal', () => {
    const story: ScheduledStory = {
      tempId: 't1', featureKey: 'ABC-1', summary: 'S', sizePoints: 8, devPoints: 6, internalTestPoints: 2,
      hasTestableOutput: true, assignee: 'Dev One', sprintName: '26.3.1', sprintStartIso: '2026-05-21', sprintEndIso: '2026-06-03',
    };
    const proposal: PlanItemProposal = { id: 't1', kind: 'story', status: 'new', parentKey: 'ABC-1', payload: story, warnings: [] };
    expect(proposal.kind).toBe('story');
  });
});
