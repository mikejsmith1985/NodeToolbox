// piPlanDates.test.ts — The working-day + deploy-cadence date engine (spec 028, contract date-cadence.md).
// Proves the primitives (working-day arithmetic, rolling) and the composed five-date computation, all pure.

import { describe, expect, it } from 'vitest';

import {
  addWorkingDays,
  computeItemDates,
  rollToWorkingDay,
  workingDaysBetween,
} from './piPlanDates.ts';
import type { ReleaseSchedule, ScheduledStory, WorkingCalendar } from './piPlanTypes.ts';

// Standard Mon–Fri calendar with no holidays (weekend = Sunday(0), Saturday(6)).
const STD_CAL: WorkingCalendar = { weekendDays: [0, 6], holidayIsoDates: [] };

function makeStory(overrides: Partial<ScheduledStory>): ScheduledStory {
  return {
    tempId: 't1',
    featureKey: 'ABC-1',
    summary: 'Story',
    sizePoints: 4,
    devPoints: 3,
    internalTestPoints: 1,
    hasTestableOutput: true,
    assignee: 'Dev One',
    sprintName: '26.3.1',
    sprintStartIso: '2026-08-03', // a Monday
    sprintEndIso: '2026-08-14',
    ...overrides,
  };
}

function ctx(releaseSchedule: ReleaseSchedule) {
  return {
    calendar: STD_CAL,
    piStartIso: '2026-05-21',
    piEndIso: '2026-07-29',
    releaseSchedule,
    pointsPerWorkingDay: 1,
    todayIso: '2026-07-26',
  };
}

describe('working-day primitives', () => {
  it('addWorkingDays skips the weekend', () => {
    // Tue 2026-08-04 + 5 working days → Wed,Thu,Fri,Mon,Tue = 2026-08-11
    expect(addWorkingDays('2026-08-04', 5, STD_CAL)).toBe('2026-08-11');
  });

  it('addWorkingDays skips a listed holiday', () => {
    const withHoliday: WorkingCalendar = { weekendDays: [0, 6], holidayIsoDates: ['2026-08-10'] };
    // Mon 2026-08-10 is now a holiday, so the 5th working day lands one day later.
    expect(addWorkingDays('2026-08-04', 5, withHoliday)).toBe('2026-08-12');
  });

  it('rollToWorkingDay rolls a Saturday to Monday and leaves a weekday alone', () => {
    expect(rollToWorkingDay('2026-08-08', STD_CAL)).toBe('2026-08-10'); // Sat → Mon
    expect(rollToWorkingDay('2026-08-07', STD_CAL)).toBe('2026-08-07'); // Fri unchanged
  });

  it('workingDaysBetween counts only working days in the half-open interval', () => {
    // (Mon 08-03, Mon 08-10] → Tue,Wed,Thu,Fri,Mon = 5 working days
    expect(workingDaysBetween('2026-08-03', '2026-08-10', STD_CAL)).toBe(5);
  });
});

describe('computeItemDates — the five dates', () => {
  it('derives Target Start / internal-test end / INT / REL / PROD / Due per the rules', () => {
    const dated = computeItemDates(
      makeStory({}),
      ctx({ entries: [{ name: 'R1', releaseDateIso: '2026-08-20', isSuggested: false }] }),
    );
    expect(dated.targetStartIso).toBe('2026-08-03'); // Monday sprint start
    expect(dated.internalTestEndIso).toBe('2026-08-06'); // 3 dev days → Wed, 1 test day → Thu
    expect(dated.targetEndIso).toBe('2026-08-07'); // INT ≤ 1 day after internal-test end (Fri)
    expect(dated.deployIntIso).toBe(dated.targetEndIso); // invariant (analyze D1)
    expect(dated.deployRelIso).toBe('2026-08-14'); // INT + 5 working days
    expect(dated.deployProdIso).toBe('2026-08-20'); // first release on/after REL
    expect(dated.dueIso).toBe('2026-08-20');
  });

  it('rolls an INT that would fall on Saturday to the next Monday', () => {
    // devPoints 4 → dev ends Thu 08-06; test 1 day → Fri 08-07; INT = Fri+1 = Sat → Mon 08-10
    const dated = computeItemDates(
      makeStory({ devPoints: 4, internalTestPoints: 1, sizePoints: 5 }),
      ctx({ entries: [{ name: 'R1', releaseDateIso: '2026-09-01', isSuggested: false }] }),
    );
    expect(dated.targetEndIso).toBe('2026-08-10');
  });

  it('sets no internal-test end when the story has no testable output', () => {
    const dated = computeItemDates(
      makeStory({ hasTestableOutput: false, internalTestPoints: 0, devPoints: 4, sizePoints: 4 }),
      ctx({ entries: [{ name: 'R1', releaseDateIso: '2026-09-01', isSuggested: false }] }),
    );
    expect(dated.internalTestEndIso).toBeNull();
  });

  it('allows a Due date after the PI end (production may follow the PI)', () => {
    const dated = computeItemDates(
      makeStory({}),
      ctx({ entries: [{ name: 'R1', releaseDateIso: '2026-08-20', isSuggested: false }] }),
    );
    expect(dated.dueIso! > '2026-07-29').toBe(true); // beyond piEnd
  });

  it('returns a null PROD/Due when no release exists on or after REL', () => {
    const dated = computeItemDates(makeStory({}), ctx({ entries: [] }));
    expect(dated.deployProdIso).toBeNull();
    expect(dated.dueIso).toBeNull();
  });

  it('is deterministic — identical inputs produce identical dates', () => {
    const schedule: ReleaseSchedule = { entries: [{ name: 'R1', releaseDateIso: '2026-08-20', isSuggested: false }] };
    const a = computeItemDates(makeStory({}), ctx(schedule));
    const b = computeItemDates(makeStory({}), ctx(schedule));
    expect(a).toEqual(b);
  });

  it('records a derivation string for every date', () => {
    const dated = computeItemDates(
      makeStory({}),
      ctx({ entries: [{ name: 'R1', releaseDateIso: '2026-08-20', isSuggested: false }] }),
    );
    expect(dated.derivations.targetEndIso).toMatch(/INT/i);
    expect(dated.derivations.deployRelIso).toMatch(/5 working days/i);
  });
});
