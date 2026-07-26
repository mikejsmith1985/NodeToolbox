// piPlanDates.explain.test.ts — Every date carries a rule+input derivation, and the gate/DoD semantics
// hold (spec 028, US3, SC-005).

import { describe, expect, it } from 'vitest';

import { computeItemDates } from './piPlanDates.ts';
import type { ReleaseSchedule, ScheduledStory, WorkingCalendar } from './piPlanTypes.ts';

const CAL: WorkingCalendar = { weekendDays: [0, 6], holidayIsoDates: [] };
const SCHEDULE: ReleaseSchedule = { entries: [{ name: 'R1', releaseDateIso: '2026-08-20', isSuggested: false }] };

function story(overrides: Partial<ScheduledStory> = {}): ScheduledStory {
  return {
    tempId: 't1', featureKey: 'ABC-1', summary: 'S', sizePoints: 4, devPoints: 3, internalTestPoints: 1,
    hasTestableOutput: true, assignee: 'Dev One', sprintName: '26.3.1', sprintStartIso: '2026-08-03', sprintEndIso: '2026-08-14', ...overrides,
  };
}

const CTX = {
  calendar: CAL, piStartIso: '2026-05-21', piEndIso: '2026-07-29', releaseSchedule: SCHEDULE, pointsPerWorkingDay: 1, todayIso: '2026-07-26',
};

describe('date derivations', () => {
  it('names the rule and inputs for each date', () => {
    const dates = computeItemDates(story(), CTX);
    expect(dates.derivations.targetStartIso).toMatch(/sprint/i);
    expect(dates.derivations.targetEndIso).toMatch(/INT/i);
    expect(dates.derivations.deployRelIso).toMatch(/5 working days/i);
    expect(dates.derivations.deployProdIso).toMatch(/release/i);
  });

  it('gives no internal-test gate when the story has no testable output', () => {
    const dates = computeItemDates(story({ hasTestableOutput: false, internalTestPoints: 0 }), CTX);
    expect(dates.internalTestEndIso).toBeNull();
    expect(dates.derivations.internalTestEndIso).toMatch(/no internal-test/i);
  });

  it('keeps the Due date (production) allowed to land after the PI end', () => {
    const dates = computeItemDates(story(), CTX);
    expect(dates.dueIso).toBe('2026-08-20');
    expect(dates.dueIso! > CTX.piEndIso).toBe(true);
  });
});
