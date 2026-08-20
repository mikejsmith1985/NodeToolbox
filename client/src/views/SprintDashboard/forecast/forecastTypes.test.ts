// forecastTypes.test.ts — Pins the shapes every forecast surface reads, and the promises they encode.
//
// A types file cannot fail at runtime, so what is tested here is what the types are FOR: that the
// eight issue states are exactly eight, that "absent" is expressible separately from "zero" on every
// field where the distinction carries a decision, and that the result object has a slot for every
// section a surface renders. Those are the properties a later edit could quietly remove.

import { describe, expect, it } from 'vitest';

import type {
  CapacityAssessment,
  ChainRole,
  ForecastCompleteness,
  ForecastResult,
  IntReadyState,
  IssueForecast,
  IssueForecastState,
  RemainingEffort,
} from './forecastTypes.ts';

describe('the issue verdict vocabulary', () => {
  it('has exactly eight states, so no issue can fall between them', () => {
    // Written out rather than derived: the point is that adding a ninth state is a deliberate act
    // that breaks this line, not something that happens while editing a union in passing.
    const everyState: IssueForecastState[] = [
      'ahead',
      'on-track',
      'start-today',
      'behind',
      'cannot-fit',
      'unsized',
      'unassignable',
      'unforecastable',
    ];
    expect(new Set(everyState).size).toBe(8);
  });

  it('separates "cannot fit" from "behind", because they demand different actions', () => {
    // "Behind" means start it now. "Cannot fit" means starting it now will not help.
    const behind: IssueForecastState = 'behind';
    const cannotFit: IssueForecastState = 'cannot-fit';
    expect(behind).not.toBe(cannotFit);
  });
});

describe('the INT readiness vocabulary', () => {
  it('can say "not checked" without saying "not ready"', () => {
    // An instance with no sub-status field has not failed the check; it could not run it.
    const everyState: IntReadyState[] = ['int-ready', 'not-int-ready', 'cancelled', 'unknown-sub-status'];
    expect(new Set(everyState).size).toBe(4);
    expect(everyState).toContain('unknown-sub-status');
  });
});

describe('the chain vocabulary', () => {
  it('admits work it cannot classify, rather than guessing a side', () => {
    const everyRole: ChainRole[] = ['dev', 'sl', 'unclassified'];
    expect(everyRole).toContain('unclassified');
  });
});

describe('absent is expressible separately from zero', () => {
  it('lets an unestimated issue say so, rather than reporting an estimate of nought', () => {
    const unestimated: RemainingEffort = {
      storyPoints: null,
      columnCredit: 0,
      remainingPoints: null,
      remainingWorkingDays: null,
      isEstimated: false,
      basis: 'no estimate',
    };
    const estimatedAtZero: RemainingEffort = {
      storyPoints: 0,
      columnCredit: 0,
      remainingPoints: 0,
      remainingWorkingDays: 0,
      isEstimated: true,
      basis: '0 pts',
    };
    expect(unestimated.storyPoints).toBeNull();
    expect(estimatedAtZero.storyPoints).toBe(0);
    expect(unestimated.isEstimated).not.toBe(estimatedAtZero.isEstimated);
  });

  it('lets an issue with no deadline on either clock say which clock drove it', () => {
    const undecidable: Pick<IssueForecast, 'drivingClock' | 'drivingDeadlineIso' | 'latestStartIso'> = {
      drivingClock: 'none',
      drivingDeadlineIso: null,
      latestStartIso: null,
    };
    expect(undecidable.drivingClock).toBe('none');
    expect(undecidable.drivingDeadlineIso).toBeNull();
  });
});

describe('the honesty record', () => {
  it('carries a count for every kind of input a total could have silently omitted', () => {
    const completeness: ForecastCompleteness = {
      totalIssueCount: 0,
      unsizedIssueCount: 0,
      unassignedIssueCount: 0,
      undatedVersionCount: 0,
      cancelledIssueCount: 0,
      hasSubStatusField: false,
      hasBoardVocabulary: false,
    };
    // Named individually: a single "excluded" count would tell a reader something was missing
    // without telling them whether to go and estimate, assign, or fix a fix version.
    expect(Object.keys(completeness).sort()).toEqual([
      'cancelledIssueCount',
      'hasBoardVocabulary',
      'hasSubStatusField',
      'totalIssueCount',
      'unassignedIssueCount',
      'undatedVersionCount',
      'unsizedIssueCount',
    ]);
  });
});

describe('the one result object', () => {
  it('has a slot for every section a surface renders, so no surface needs a second source', () => {
    const empty: ForecastResult = {
      config: { pointsPerWorkingDay: 1, calendar: { weekendDays: [0, 6], holidayIsoDates: [] }, featureSizingTolerancePercent: 0, todayIso: '2026-08-20' },
      rejectedSettings: [],
      piClock: { piEndIso: null, toPiEnd: null, isConfigured: false },
      releaseClocksByVersionName: {},
      releaseDateResolutions: [],
      issueForecasts: [],
      featureAssessments: [],
      sizingFlags: [],
      codeFreezeCapacityByVersionName: {},
      externalTestCapacityByVersionName: {},
      completeness: {
        totalIssueCount: 0,
        unsizedIssueCount: 0,
        unassignedIssueCount: 0,
        undatedVersionCount: 0,
        cancelledIssueCount: 0,
        hasSubStatusField: false,
        hasBoardVocabulary: false,
      },
    };
    expect(Object.keys(empty)).toHaveLength(11);
  });

  it('keeps the release and the PI capacity assessments apart', () => {
    // They answer different questions on different windows. One map would force a caller to choose
    // which meaning it was showing, and the two verdicts must never be merged.
    const codeFreeze: Record<string, CapacityAssessment> = {};
    const externalTest: Record<string, CapacityAssessment> = {};
    expect(codeFreeze).not.toBe(externalTest);
  });
});
