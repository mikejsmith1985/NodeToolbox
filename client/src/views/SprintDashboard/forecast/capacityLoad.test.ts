// capacityLoad.test.ts — Whether the work committed to a window fits the people holding it.
//
// The user's own example is the first test: fourteen working days to code freeze, one person
// holding eighteen points, so they are over by four.
//
// Two rules here are easy to get subtly wrong and would flatter every release. Counting the whole
// roster as capacity lets a release "fit" on the strength of people who are not working on it. And
// spreading unassigned work across a pool makes it disappear into an average, when the fact that
// nobody owns it is the finding.

import { describe, expect, it } from 'vitest';

import { assessCapacity } from './capacityLoad.ts';
import type { CapacityItem, CapacityPerson, ForecastWindow } from './forecastTypes.ts';

/** Fourteen working days ahead — the window from the user's own worked example. */
function windowOf(workingDayCount: number, hasPassed = false): ForecastWindow {
  return {
    kind: 'to-code-freeze',
    startIso: '2026-08-20',
    endIso: '2026-09-11',
    workingDayCount,
    hasPassed,
  };
}

function person(overrides: Partial<CapacityPerson> = {}): CapacityPerson {
  return {
    personKey: 'acct-1',
    displayName: 'Smith, Jane (CTR)',
    isOnRoster: true,
    canDevelop: true,
    canInternalTest: false,
    ...overrides,
  };
}

function item(overrides: Partial<CapacityItem> = {}): CapacityItem {
  return {
    issueKey: 'ENC-1',
    assigneePersonKey: 'acct-1',
    remainingWorkingDays: 3,
    isEstimated: true,
    isInScope: true,
    chainRole: 'dev',
    ...overrides,
  };
}

const ALL_ROLES = { roleFilter: 'all' as const, undatedIssueCount: 0 };

describe('per-person load', () => {
  it('reports a person holding eighteen days against a fourteen-day window as over by four', () => {
    // The user's worked example, in their own words: "if I have 14 work days ... any individual that
    // has more than 14 story points of effort assigned to them is over capacity".
    const assessment = assessCapacity(
      [item({ remainingWorkingDays: 18 })],
      [person()],
      windowOf(14),
      ALL_ROLES,
    );

    expect(assessment.personLoads[0].overCapacityWorkingDays).toBe(4);
    expect(assessment.personLoads[0].isOverCapacity).toBe(true);
  });

  it('treats a person holding exactly the window as not over capacity', () => {
    const assessment = assessCapacity([item({ remainingWorkingDays: 14 })], [person()], windowOf(14), ALL_ROLES);
    expect(assessment.personLoads[0].isOverCapacity).toBe(false);
  });

  it('separates the in-scope load from everything else a person holds', () => {
    // Without this somebody looks free while drowning in another release.
    const assessment = assessCapacity(
      [
        item({ issueKey: 'ENC-1', remainingWorkingDays: 5, isInScope: true }),
        item({ issueKey: 'ENC-2', remainingWorkingDays: 9, isInScope: false }),
      ],
      [person()],
      windowOf(14),
      ALL_ROLES,
    );

    expect(assessment.personLoads[0].inScopeWorkingDays).toBe(5);
    expect(assessment.personLoads[0].totalAssignedWorkingDays).toBe(14);
  });

  it('lists the in-scope issues behind each figure, so it can be checked', () => {
    const assessment = assessCapacity(
      [item({ issueKey: 'ENC-1' }), item({ issueKey: 'ENC-2', isInScope: false })],
      [person()],
      windowOf(14),
      ALL_ROLES,
    );

    expect(assessment.personLoads[0].inScopeIssueKeys).toEqual(['ENC-1']);
  });

  it('reports work held by somebody nobody rostered, rather than dropping it', () => {
    const assessment = assessCapacity(
      [item({ assigneePersonKey: 'acct-stranger' })],
      [person()],
      windowOf(14),
      ALL_ROLES,
    );

    const stranger = assessment.personLoads.find((load) => load.personKey === 'acct-stranger');
    expect(stranger?.isOnRoster).toBe(false);
  });

  it('counts unestimated work as no days and says how much of it there was', () => {
    const assessment = assessCapacity(
      [item({ remainingWorkingDays: null, isEstimated: false }), item({ issueKey: 'ENC-2', remainingWorkingDays: 3 })],
      [person()],
      windowOf(14),
      ALL_ROLES,
    );

    expect(assessment.personLoads[0].inScopeWorkingDays).toBe(3);
    expect(assessment.personLoads[0].unsizedIssueCount).toBe(1);
  });

  it('puts the most over-capacity person first, then orders by name', () => {
    const assessment = assessCapacity(
      [
        item({ issueKey: 'A', assigneePersonKey: 'p-1', remainingWorkingDays: 20 }),
        item({ issueKey: 'B', assigneePersonKey: 'p-2', remainingWorkingDays: 30 }),
      ],
      [person({ personKey: 'p-1', displayName: 'Alpha' }), person({ personKey: 'p-2', displayName: 'Bravo' })],
      windowOf(14),
      ALL_ROLES,
    );

    expect(assessment.personLoads.map((load) => load.displayName)).toEqual(['Bravo', 'Alpha']);
  });
});

describe('unassigned work', () => {
  it('names it separately instead of spreading it across a pool', () => {
    // Pooling it would make the finding — that nobody owns this — disappear into an average.
    const assessment = assessCapacity(
      [
        item({ issueKey: 'ENC-1', assigneePersonKey: null, remainingWorkingDays: 4 }),
        item({ issueKey: 'ENC-2', assigneePersonKey: null, remainingWorkingDays: 3 }),
      ],
      [person()],
      windowOf(14),
      ALL_ROLES,
    );

    expect(assessment.unassignedWorkingDays).toBe(7);
    expect(assessment.unassignedIssueKeys).toEqual(['ENC-1', 'ENC-2']);
    expect(assessment.personLoads).toEqual([]);
  });

  it('still counts it toward the release total', () => {
    const assessment = assessCapacity(
      [item({ assigneePersonKey: null, remainingWorkingDays: 4 })],
      [person()],
      windowOf(14),
      ALL_ROLES,
    );

    expect(assessment.totalRemainingWorkingDays).toBe(4);
  });
});

describe('the release total', () => {
  it('raises the scope flag when the work outruns the people holding it', () => {
    const assessment = assessCapacity(
      [
        item({ issueKey: 'A', assigneePersonKey: 'p-1', remainingWorkingDays: 25 }),
        item({ issueKey: 'B', assigneePersonKey: 'p-2', remainingWorkingDays: 25 }),
      ],
      [person({ personKey: 'p-1', displayName: 'Alpha' }), person({ personKey: 'p-2', displayName: 'Bravo' })],
      windowOf(14),
      ALL_ROLES,
    );

    // 50 days of work against 28 available.
    expect(assessment.shortfallWorkingDays).toBe(22);
    expect(assessment.shouldRemoveScope).toBe(true);
  });

  it('raises no flag when the work fits', () => {
    const assessment = assessCapacity([item({ remainingWorkingDays: 5 })], [person()], windowOf(14), ALL_ROLES);
    expect(assessment.shortfallWorkingDays).toBe(0);
    expect(assessment.shouldRemoveScope).toBe(false);
  });

  it('counts only people who actually hold some of this work as capacity', () => {
    // An idle roster member is not release capacity. Counting them would let a release "fit" on the
    // strength of people who are not working on it.
    const assessment = assessCapacity(
      [item({ assigneePersonKey: 'p-1', remainingWorkingDays: 5 })],
      [person({ personKey: 'p-1', displayName: 'Alpha' }), person({ personKey: 'p-2', displayName: 'Idle' })],
      windowOf(14),
      ALL_ROLES,
    );

    expect(assessment.totalAvailableWorkingDays).toBe(14);
  });

  it('reports a passed window as having no capacity at all', () => {
    const assessment = assessCapacity([item({ remainingWorkingDays: 3 })], [person()], windowOf(0, true), ALL_ROLES);
    expect(assessment.personLoads[0].availableWorkingDays).toBe(0);
    expect(assessment.personLoads[0].isOverCapacity).toBe(true);
  });

  it('still reports a total when nobody is assigned to any of it', () => {
    const assessment = assessCapacity(
      [item({ assigneePersonKey: null, remainingWorkingDays: 9 })],
      [],
      windowOf(14),
      ALL_ROLES,
    );

    expect(assessment.totalRemainingWorkingDays).toBe(9);
    expect(assessment.totalAvailableWorkingDays).toBe(0);
    expect(assessment.shouldRemoveScope).toBe(true);
  });

  it('carries the undated count through, so no total reads as more complete than it is', () => {
    const assessment = assessCapacity([item()], [person()], windowOf(14), { roleFilter: 'all', undatedIssueCount: 3 });
    expect(assessment.undatedIssueCount).toBe(3);
  });

  it('survives having nothing to assess', () => {
    const assessment = assessCapacity([], [], windowOf(14), ALL_ROLES);
    expect(assessment.totalRemainingWorkingDays).toBe(0);
    expect(assessment.shouldRemoveScope).toBe(false);
  });
});

describe('the role filter', () => {
  const DEV = person({ personKey: 'dev-1', displayName: 'Dev', canDevelop: true, canInternalTest: false });
  const TESTER = person({ personKey: 'test-1', displayName: 'Tester', canDevelop: false, canInternalTest: true });

  const MIXED_WORK = [
    item({ issueKey: 'D-1', assigneePersonKey: 'dev-1', chainRole: 'dev', remainingWorkingDays: 5 }),
    item({ issueKey: 'S-1', assigneePersonKey: 'test-1', chainRole: 'sl', remainingWorkingDays: 4 }),
    item({ issueKey: 'U-1', assigneePersonKey: 'dev-1', chainRole: 'unclassified', remainingWorkingDays: 2 }),
  ];

  it('counts unclassified work as dev work, so it is never silently dropped', () => {
    const assessment = assessCapacity(MIXED_WORK, [DEV, TESTER], windowOf(14), {
      roleFilter: 'dev',
      undatedIssueCount: 0,
    });

    expect(assessment.totalRemainingWorkingDays).toBe(7);
    expect(assessment.personLoads.map((load) => load.displayName)).toEqual(['Dev']);
  });

  it('assesses the test window against testers and test work only', () => {
    const assessment = assessCapacity(MIXED_WORK, [DEV, TESTER], windowOf(10), {
      roleFilter: 'test',
      undatedIssueCount: 0,
    });

    expect(assessment.totalRemainingWorkingDays).toBe(4);
    expect(assessment.personLoads.map((load) => load.displayName)).toEqual(['Tester']);
  });

  it('filters nothing when every role is wanted', () => {
    const assessment = assessCapacity(MIXED_WORK, [DEV, TESTER], windowOf(14), ALL_ROLES);
    expect(assessment.totalRemainingWorkingDays).toBe(11);
  });
});
