// laneSchedule.test.ts — Whether the REST of a Feature is going to land.
//
// The board already draws how much is done. That is a different question, and usually the less
// urgent one: a Feature at 80% with every remaining item behind is in more trouble than one at 40%
// that is on track, and the completion bar draws those two the other way round.

import { describe, expect, it } from 'vitest';

import { buildLaneSchedule } from './laneSchedule.ts';
import type { FeatureDodAssessment, IssueForecast, IssueForecastState } from './forecastTypes.ts';

function forecast(state: IssueForecastState, issueKey = 'ENC-1'): IssueForecast {
  return {
    issueKey,
    summary: 'Build it',
    teamProfileId: 'team-a',
    assigneeDisplayName: 'Smith, Jane (CTR)',
    assigneeAccountId: 'acct-1',
    effort: {
      storyPoints: 3,
      columnCredit: 0,
      remainingPoints: 3,
      remainingWorkingDays: 3,
      isEstimated: state !== 'unsized',
      basis: '3 pts',
    },
    releaseDeadlineIso: '2026-09-11',
    piDeadlineIso: '2026-11-06',
    drivingDeadlineIso: '2026-09-11',
    drivingClock: 'release',
    latestStartIso: '2026-09-09',
    actualStartIso: null,
    state,
    slackWorkingDays: 0,
    storedTargetStartIso: null,
    hasStoredDateDisagreement: false,
    reason: 'three days left',
  };
}

function assessment(overrides: Partial<FeatureDodAssessment> = {}): FeatureDodAssessment {
  return {
    featureKey: 'DENP-1',
    intReadyState: 'not-int-ready',
    blockingIssueKeys: [],
    cancelledIssueKeys: [],
    devCompleteIso: '2026-09-01',
    slStartIso: '2026-09-02',
    slWorkingDays: 2,
    dodDateIso: '2026-09-03',
    hasNoSlStory: false,
    unclassifiedIssueKeys: [],
    piVerdict: 'meets',
    riskCause: null,
    shortfallWorkingDays: null,
    ...overrides,
  };
}

describe('the band', () => {
  it('draws each verdict in proportion to how much of the Feature it is', () => {
    const schedule = buildLaneSchedule(
      [forecast('behind', 'A'), forecast('on-track', 'B'), forecast('on-track', 'C'), forecast('on-track', 'D')],
      assessment(),
    );

    const behind = schedule.segments.find((segment) => segment.state === 'behind');
    expect(behind?.widthPercent).toBe(25);
    expect(behind?.issueCount).toBe(1);
  });

  it('puts the problems first, so the eye lands on them', () => {
    const schedule = buildLaneSchedule(
      [forecast('ahead', 'A'), forecast('behind', 'B'), forecast('cannot-fit', 'C')],
      assessment(),
    );

    expect(schedule.segments.map((segment) => segment.state)).toEqual(['cannot-fit', 'behind', 'ahead']);
  });

  it('draws nothing for a verdict no issue is in', () => {
    const schedule = buildLaneSchedule([forecast('on-track')], assessment());
    expect(schedule.segments).toHaveLength(1);
  });

  it('names every run in words, so colour is never the only signal', () => {
    const schedule = buildLaneSchedule([forecast('behind'), forecast('on-track', 'B')], assessment());
    schedule.segments.forEach((segment) => expect(segment.label.length).toBeGreaterThan(0));
  });

  it('is proportional by issue COUNT, so unsized work still takes up room', () => {
    // By points, an unsized item has no width at all — and the Feature would draw narrower and
    // healthier than it really is, which is the opposite of what the band is for.
    const schedule = buildLaneSchedule([forecast('unsized', 'A'), forecast('on-track', 'B')], assessment());
    expect(schedule.segments.find((segment) => segment.state === 'unsized')?.widthPercent).toBe(50);
  });
});

describe('the headline', () => {
  it('leads with how much is behind, because that is what needs doing', () => {
    const schedule = buildLaneSchedule([forecast('behind', 'A'), forecast('on-track', 'B')], assessment());
    expect(schedule.headline).toBe('1 behind');
    expect(schedule.tone).toBe('late');
  });

  it('counts a passed deadline as behind too', () => {
    const schedule = buildLaneSchedule([forecast('cannot-fit', 'A'), forecast('behind', 'B')], assessment());
    expect(schedule.headline).toBe('2 behind');
  });

  it('falls to what must start today once nothing is actually late', () => {
    const schedule = buildLaneSchedule([forecast('start-today', 'A'), forecast('on-track', 'B')], assessment());
    expect(schedule.headline).toBe('1 must start today');
    expect(schedule.tone).toBe('due');
  });

  it('names WHICH half is at risk, because the two need different conversations', () => {
    const testSqueeze = buildLaneSchedule([forecast('on-track')],
      assessment({ piVerdict: 'at-risk', riskCause: 'test-squeeze' }));
    expect(testSqueeze.headline).toContain('test squeeze');

    const devTooLarge = buildLaneSchedule([forecast('on-track')],
      assessment({ piVerdict: 'at-risk', riskCause: 'dev-too-large' }));
    expect(devTooLarge.headline).toContain('dev too large');
  });

  it('says a Feature is ready once every item reached Integration Test', () => {
    const schedule = buildLaneSchedule([forecast('on-track')], assessment({ intReadyState: 'int-ready' }));
    expect(schedule.headline).toBe('Ready for Integrated Test');
    expect(schedule.tone).toBe('good');
  });

  it('says a Feature nobody has broken down has no work yet, rather than calling it on track', () => {
    const schedule = buildLaneSchedule([], assessment());
    expect(schedule.headline).toBe('No work yet');
    expect(schedule.tone).toBe('unknown');
  });

  it('admits when nothing in the Feature could be forecast at all', () => {
    const schedule = buildLaneSchedule([forecast('unsized', 'A'), forecast('unforecastable', 'B')], assessment());
    expect(schedule.headline).toBe('Cannot be forecast');
    expect(schedule.tone).toBe('unknown');
  });

  it('says on track only when nothing is late and something was measurable', () => {
    const schedule = buildLaneSchedule([forecast('on-track', 'A'), forecast('unsized', 'B')], assessment());
    expect(schedule.headline).toBe('On track');
  });
});

describe('the dates', () => {
  it('carries the day the Feature can reach Integration Test', () => {
    expect(buildLaneSchedule([forecast('on-track')], assessment()).dodDateIso).toBe('2026-09-03');
  });

  it('reports a Feature that misses the PI', () => {
    const schedule = buildLaneSchedule([forecast('on-track')], assessment({ piVerdict: 'at-risk' }));
    expect(schedule.isMissingPi).toBe(true);
  });

  it('survives a Feature with no assessment at all', () => {
    const schedule = buildLaneSchedule([forecast('on-track')], null);
    expect(schedule.dodDateIso).toBeNull();
    expect(schedule.isMissingPi).toBe(false);
  });

  it('counts the unsized work behind the band, so a reader knows what it omits', () => {
    const schedule = buildLaneSchedule([forecast('unsized', 'A'), forecast('on-track', 'B')], assessment());
    expect(schedule.unsizedIssueCount).toBe(1);
    expect(schedule.totalIssueCount).toBe(2);
  });
});
