// issueForecast.test.ts — "If these issues don't start today we will be behind."
//
// That sentence is the whole reason this feature exists, and these tests are what make it true.
//
// The state precedence is tested as hard as the arithmetic, because getting it wrong is silent:
// an unsized issue reported as "on track" looks exactly like a measured one, and an issue that
// cannot fit reported as "behind" sends somebody to start work that starting will not save.

import { describe, expect, it } from 'vitest';

import { computeIssueForecast, computeIssueForecasts } from './issueForecast.ts';
import { computeRemainingEffort } from './effortModel.ts';
import { buildForecastConfig } from './forecastSettings.ts';
import type { IssueForecastInput } from './forecastTypes.ts';

const TODAY_ISO = '2026-08-20';

const CONFIG = buildForecastConfig(
  { pointsPerWorkingDay: 1, holidayIsoDates: [], featureSizingTolerancePercent: 0 },
  TODAY_ISO,
).config;

/** A single-column board, so effort is charged at full size unless a test says otherwise. */
const ONE_COLUMN = ['col-1'];

/** An input carrying `points` of unstarted work against a deadline, so tests vary one thing. */
function inputWith(overrides: Partial<IssueForecastInput> = {}): IssueForecastInput {
  return {
    issueKey: 'ENC-1',
    summary: 'Build the thing',
    teamProfileId: 'team-a',
    assigneeAccountId: 'acct-1',
    assigneeDisplayName: 'Smith, Jane (CTR)',
    effort: computeRemainingEffort(3, 'col-1', ONE_COLUMN, false, 1),
    releaseDeadlineIso: '2026-09-11',
    piDeadlineIso: '2026-11-06',
    actualStartIso: null,
    storedTargetStartIso: null,
    isComplete: false,
    ...overrides,
  };
}

/** Effort of exactly `points` working days at one point a day, untouched. */
function effortOf(points: number | null) {
  return computeRemainingEffort(points, 'col-1', ONE_COLUMN, false, 1);
}

describe('the driving deadline', () => {
  it('takes the release deadline when it is the earlier of the two', () => {
    const forecast = computeIssueForecast(inputWith(), CONFIG);
    expect(forecast.drivingClock).toBe('release');
    expect(forecast.drivingDeadlineIso).toBe('2026-09-11');
  });

  it('takes the PI deadline when the release is further out', () => {
    const forecast = computeIssueForecast(
      inputWith({ releaseDeadlineIso: '2026-12-01', piDeadlineIso: '2026-11-06' }),
      CONFIG,
    );
    expect(forecast.drivingClock).toBe('pi');
    expect(forecast.drivingDeadlineIso).toBe('2026-11-06');
  });

  it('falls back to the clock that exists when only one does', () => {
    expect(computeIssueForecast(inputWith({ piDeadlineIso: null }), CONFIG).drivingClock).toBe('release');
    expect(computeIssueForecast(inputWith({ releaseDeadlineIso: null }), CONFIG).drivingClock).toBe('pi');
  });

  it('prefers the release clock on a tie, because that is the one the team operates on', () => {
    const forecast = computeIssueForecast(
      inputWith({ releaseDeadlineIso: '2026-09-11', piDeadlineIso: '2026-09-11' }),
      CONFIG,
    );
    expect(forecast.drivingClock).toBe('release');
  });

  it('has no clock at all when neither deadline exists', () => {
    const forecast = computeIssueForecast(
      inputWith({ releaseDeadlineIso: null, piDeadlineIso: null }),
      CONFIG,
    );
    expect(forecast.drivingClock).toBe('none');
    expect(forecast.state).toBe('unforecastable');
  });
});

describe('the latest start date', () => {
  it('includes its own start day, so one day of work due today starts today', () => {
    const forecast = computeIssueForecast(
      inputWith({ effort: effortOf(1), releaseDeadlineIso: TODAY_ISO, piDeadlineIso: null }),
      CONFIG,
    );
    expect(forecast.latestStartIso).toBe(TODAY_ISO);
    expect(forecast.state).toBe('start-today');
  });

  it('steps back over a weekend', () => {
    // Monday 2026-08-24 deadline, 3 days of work: Thu 20, Fri 21, Mon 24.
    const forecast = computeIssueForecast(
      inputWith({ effort: effortOf(3), releaseDeadlineIso: '2026-08-24', piDeadlineIso: null }),
      CONFIG,
    );
    expect(forecast.latestStartIso).toBe('2026-08-20');
  });

  it('steps back over a holiday', () => {
    const holidayConfig = buildForecastConfig(
      { pointsPerWorkingDay: 1, holidayIsoDates: ['2026-08-21'], featureSizingTolerancePercent: 0 },
      TODAY_ISO,
    ).config;
    // Monday 2026-08-24, 3 days, with Friday out: Wed 19, Thu 20, Mon 24.
    const forecast = computeIssueForecast(
      inputWith({ effort: effortOf(3), releaseDeadlineIso: '2026-08-24', piDeadlineIso: null }),
      holidayConfig,
    );
    expect(forecast.latestStartIso).toBe('2026-08-19');
  });
});

describe('the state precedence', () => {
  it('reports BEHIND when the latest start has passed and nothing has begun', () => {
    // 5 days of work against a Monday deadline leaving only three working days: it will land late,
    // and the slack figure says by how much.
    const forecast = computeIssueForecast(
      inputWith({ effort: effortOf(5), releaseDeadlineIso: '2026-08-24', piDeadlineIso: null }),
      CONFIG,
    );
    expect(forecast.state).toBe('behind');
    expect(forecast.slackWorkingDays).toBeLessThan(0);
  });

  it('reports START TODAY when the runway is exactly used up', () => {
    // 3 days of work, 3 working days left counting today.
    const forecast = computeIssueForecast(
      inputWith({ effort: effortOf(3), releaseDeadlineIso: '2026-08-24', piDeadlineIso: null }),
      CONFIG,
    );
    expect(forecast.state).toBe('start-today');
    expect(forecast.slackWorkingDays).toBe(0);
  });

  it('reports ON TRACK when there is runway to spare', () => {
    const forecast = computeIssueForecast(
      inputWith({ effort: effortOf(3), releaseDeadlineIso: '2026-09-11', piDeadlineIso: null }),
      CONFIG,
    );
    expect(forecast.state).toBe('on-track');
    expect(forecast.slackWorkingDays).toBeGreaterThan(0);
  });

  it('reports AHEAD for work that began before it had to', () => {
    const forecast = computeIssueForecast(
      inputWith({
        effort: effortOf(3),
        releaseDeadlineIso: '2026-09-11',
        piDeadlineIso: null,
        actualStartIso: '2026-08-11',
      }),
      CONFIG,
    );
    expect(forecast.state).toBe('ahead');
  });

  it('reports CANNOT FIT only when the deadline itself has gone', () => {
    // The two states must differ in KIND, not merely in degree. Behind says start it now and it
    // lands late by the slack figure; cannot-fit says "start it" is not even advice, because the
    // day it was due for has already passed. Comparing effort against days remaining would have
    // made this condition identical to a latest start in the past, leaving one state unreachable.
    const forecast = computeIssueForecast(
      inputWith({ effort: effortOf(8), releaseDeadlineIso: '2026-08-10', piDeadlineIso: null }),
      CONFIG,
    );
    expect(forecast.state).toBe('cannot-fit');
  });

  it('does not report CANNOT FIT for oversized work that still has a deadline ahead of it', () => {
    // It will be late, and the slack says by how much — which is more useful than a flat refusal.
    const forecast = computeIssueForecast(
      inputWith({ effort: effortOf(20), releaseDeadlineIso: '2026-08-24', piDeadlineIso: null }),
      CONFIG,
    );
    expect(forecast.state).toBe('behind');
    expect(forecast.slackWorkingDays).toBeLessThan(0);
  });

  it('reports UNSIZED whatever the dates say, because every other verdict needs a size', () => {
    const forecast = computeIssueForecast(
      inputWith({ effort: effortOf(null), releaseDeadlineIso: '2026-08-21' }),
      CONFIG,
    );
    expect(forecast.state).toBe('unsized');
    expect(forecast.latestStartIso).toBeNull();
  });

  it('reports UNASSIGNABLE when nobody holds it, even though the dates work out', () => {
    const forecast = computeIssueForecast(
      inputWith({ assigneeAccountId: null, assigneeDisplayName: null }),
      CONFIG,
    );
    expect(forecast.state).toBe('unassignable');
  });

  it('never reports a started issue as behind, however long it is running', () => {
    // "Behind" means not started and out of runway. A started issue running long shows up as
    // negative slack, and at the Feature level as at-risk — not as work somebody forgot to begin.
    const forecast = computeIssueForecast(
      inputWith({ effort: effortOf(5), releaseDeadlineIso: '2026-08-24', piDeadlineIso: null, actualStartIso: '2026-08-10' }),
      CONFIG,
    );
    expect(forecast.state).not.toBe('behind');
    expect(forecast.slackWorkingDays).toBeLessThan(0);
  });

  it('reports a finished issue as on track even against a deadline that has gone', () => {
    // Nothing remains to be done, so there is nothing to be late with.
    const forecast = computeIssueForecast(
      inputWith({
        effort: computeRemainingEffort(5, 'col-1', ONE_COLUMN, true, 1),
        releaseDeadlineIso: '2026-08-10',
        piDeadlineIso: null,
        isComplete: true,
      }),
      CONFIG,
    );
    expect(forecast.state).toBe('on-track');
  });
});

describe('the stored Jira date', () => {
  it('reports a disagreement without changing the stored value', () => {
    const forecast = computeIssueForecast(
      inputWith({ effort: effortOf(3), releaseDeadlineIso: '2026-08-24', piDeadlineIso: null, storedTargetStartIso: '2026-07-01' }),
      CONFIG,
    );
    expect(forecast.hasStoredDateDisagreement).toBe(true);
    expect(forecast.storedTargetStartIso).toBe('2026-07-01');
    expect(forecast.latestStartIso).toBe('2026-08-20');
  });

  it('reports no disagreement when Jira already holds the computed day', () => {
    const forecast = computeIssueForecast(
      inputWith({ effort: effortOf(3), releaseDeadlineIso: '2026-08-24', piDeadlineIso: null, storedTargetStartIso: '2026-08-20' }),
      CONFIG,
    );
    expect(forecast.hasStoredDateDisagreement).toBe(false);
  });

  it('reports no disagreement when Jira holds nothing', () => {
    expect(computeIssueForecast(inputWith(), CONFIG).hasStoredDateDisagreement).toBe(false);
  });
});

describe('the reason', () => {
  it('is always populated, whatever the state', () => {
    const everyCase = [
      inputWith(),
      inputWith({ effort: effortOf(null) }),
      inputWith({ assigneeAccountId: null, assigneeDisplayName: null }),
      inputWith({ releaseDeadlineIso: null, piDeadlineIso: null }),
      inputWith({ effort: effortOf(8), releaseDeadlineIso: '2026-08-10', piDeadlineIso: null }),
    ];
    everyCase.forEach((input) => {
      expect(computeIssueForecast(input, CONFIG).reason.length).toBeGreaterThan(0);
    });
  });

  it('names the deadline it measured against', () => {
    const forecast = computeIssueForecast(
      inputWith({ effort: effortOf(5), releaseDeadlineIso: '2026-08-24', piDeadlineIso: null }),
      CONFIG,
    );
    expect(forecast.reason).toContain('2026-08-24');
  });
});

describe('computeIssueForecasts', () => {
  it('keeps every issue attributed to the team it came from', () => {
    const forecasts = computeIssueForecasts(
      [
        inputWith({ issueKey: 'ENC-1', teamProfileId: 'team-a' }),
        inputWith({ issueKey: 'DEN-9', teamProfileId: 'team-b' }),
      ],
      CONFIG,
    );
    expect(forecasts.map((forecast) => forecast.teamProfileId)).toEqual(['team-a', 'team-b']);
  });

  it('returns one verdict per issue, so nothing is silently absent', () => {
    const forecasts = computeIssueForecasts(
      [inputWith({ issueKey: 'ENC-1' }), inputWith({ issueKey: 'ENC-2', effort: effortOf(null) })],
      CONFIG,
    );
    expect(forecasts).toHaveLength(2);
    forecasts.forEach((forecast) => expect(forecast.state).toBeTruthy());
  });
});
