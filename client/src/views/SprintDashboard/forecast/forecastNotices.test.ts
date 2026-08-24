// forecastNotices.test.ts — The forecast admitting what it could not see.
//
// A total that omits what it missed is not a smaller number; it is a wrong one, presented
// confidently. These notices are the difference between "everything is on track" and "everything I
// could measure is on track", and only one of those is true.

import { describe, expect, it } from 'vitest';

import { buildForecastNotices } from './forecastNotices.ts';
import type { ForecastResult } from './forecastTypes.ts';

function forecastWith(overrides: Partial<ForecastResult['completeness']> = {},
  rejectedSettings: ForecastResult['rejectedSettings'] = []): ForecastResult {
  return {
    config: {
      pointsPerWorkingDay: 1,
      calendar: { weekendDays: [0, 6], holidayIsoDates: [] },
      featureSizingTolerancePercent: 0,
      todayIso: '2026-08-20',
    },
    rejectedSettings,
    piClock: { piEndIso: null, toPiEnd: null, isConfigured: false },
    releaseClocksByVersionName: {},
    releaseDateResolutions: [],
    issueForecasts: [],
    featureAssessments: [],
    sizingFlags: [],
    codeFreezeCapacityByVersionName: {},
    externalTestCapacityByVersionName: {},
    piCapacity: null,
    completeness: {
      totalIssueCount: 10,
      unsizedIssueCount: 0,
      unassignedIssueCount: 0,
      undatedVersionCount: 0,
      cancelledIssueCount: 0,
      hasSubStatusField: true,
      hasBoardVocabulary: true,
      ...overrides,
    },
  };
}

describe('buildForecastNotices', () => {
  it('says nothing when there is nothing to admit', () => {
    // A permanent "everything is fine" banner is one people learn to stop reading, and it would take
    // the real warnings down with it.
    expect(buildForecastNotices(forecastWith())).toEqual([]);
  });

  it('names unsized work', () => {
    const notices = buildForecastNotices(forecastWith({ unsizedIssueCount: 4 }));
    expect(notices[0].summary).toContain('4 unsized');
  });

  it('names unassigned work', () => {
    expect(buildForecastNotices(forecastWith({ unassignedIssueCount: 2 }))[0].summary)
      .toContain('2 unassigned');
  });

  it('names fix versions nothing could date', () => {
    expect(buildForecastNotices(forecastWith({ undatedVersionCount: 3 }))[0].summary)
      .toContain('3 undated fix versions');
  });

  it('names cancelled work it excluded, rather than dropping it out of sight', () => {
    expect(buildForecastNotices(forecastWith({ cancelledIssueCount: 5 }))[0].summary)
      .toContain('5 cancelled and excluded');
  });

  it('says when INT readiness could not be evaluated at all', () => {
    // Not the same claim as "no Feature is ready" — one is a verdict, the other is its absence.
    expect(buildForecastNotices(forecastWith({ hasSubStatusField: false }))[0].summary)
      .toContain('INT readiness is not checked');
  });

  it('lets a surface that already says so omit the sub-status line', () => {
    // The Roll-Up Board carries a fuller notice about the same fact. Two notices saying one thing is
    // the noise that stops people reading the ones that matter.
    expect(buildForecastNotices(forecastWith({ hasSubStatusField: false }), { omitSubStatusGap: true }))
      .toEqual([]);
  });

  it('says when every item was charged at full size for want of a column order', () => {
    expect(buildForecastNotices(forecastWith({ hasBoardVocabulary: false }))[0].summary)
      .toContain('charged at full size');
  });

  it('gathers every gap into one line rather than one banner each', () => {
    const notices = buildForecastNotices(forecastWith({ unsizedIssueCount: 1, unassignedIssueCount: 2 }));
    expect(notices).toHaveLength(1);
    expect(notices[0].summary).toContain('1 unsized');
    expect(notices[0].summary).toContain('2 unassigned');
  });

  it('treats a gap in the data as information, not as a problem to fix', () => {
    expect(buildForecastNotices(forecastWith({ unsizedIssueCount: 1 }))[0].tone).toBe('info');
  });

  it('treats a refused setting as a warning, because somebody can correct it in one place', () => {
    const notices = buildForecastNotices(forecastWith({}, [
      { name: 'pointsPerWorkingDay', storedValue: '0', reason: 'must be greater than zero' },
    ]));
    expect(notices[0].tone).toBe('warning');
    expect(notices[0].summary).toContain('pointsPerWorkingDay is 0');
    expect(notices[0].summary).toContain('must be greater than zero');
  });

  it('reports every refused setting separately, so all of them can be fixed at once', () => {
    const notices = buildForecastNotices(forecastWith({}, [
      { name: 'pointsPerWorkingDay', storedValue: '0', reason: 'must be greater than zero' },
      { name: 'holidayIsoDates', storedValue: 'Christmas', reason: 'is not a calendar day' },
    ]));
    expect(notices).toHaveLength(2);
  });

  it('gives every notice a stable id, so a dismissed one stays dismissed while it is still true', () => {
    const notices = buildForecastNotices(forecastWith({ unsizedIssueCount: 1 }, [
      { name: 'pointsPerWorkingDay', storedValue: '0', reason: 'must be greater than zero' },
    ]));
    expect(notices.map((notice) => notice.id)).toEqual([
      'forecast-completeness',
      'forecast-setting-pointsPerWorkingDay',
    ]);
  });
});
