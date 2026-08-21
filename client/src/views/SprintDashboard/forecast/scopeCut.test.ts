// scopeCut.test.ts — What comes out, and in whose priority order.
//
// The rule that matters most: the order is the TEAM'S, taken from the ranks they already set by
// dragging lanes on the Roll-Up Board. This module invents no priority of its own, because a tool
// that reorders somebody's backlog while claiming to report on it is worse than one that says
// nothing.

import { describe, expect, it } from 'vitest';

import { buildScopeCutPlan } from './scopeCut.ts';
import { computeForecast } from './forecastCompose.ts';
import { buildForecastConfig } from './forecastSettings.ts';
import type { ForecastIssue, ForecastResult } from './forecastTypes.ts';

const CONFIG = buildForecastConfig(
  { pointsPerWorkingDay: 1, holidayIsoDates: [], featureSizingTolerancePercent: 0 },
  '2026-08-20',
).config;

function issue(overrides: Partial<ForecastIssue> = {}): ForecastIssue {
  return {
    key: 'ENC-1',
    summary: 'Build the thing',
    typeBucket: 'story',
    featureKey: 'DENP-1',
    columnId: '',
    statusName: 'Working',
    subStatusValue: null,
    assigneeAccountId: 'acct-1',
    assigneeDisplayName: 'Smith, Jane (CTR)',
    fixVersionNames: ['Release 10/02/2026'],
    storyPoints: 5,
    isComplete: false,
    actualStartIso: null,
    storedTargetStartIso: null,
    ...overrides,
  };
}

function forecastOf(items: ForecastIssue[]): ForecastResult {
  return computeForecast(
    {
      items,
      orderedColumnIds: [],
      fixVersions: [{ name: 'Release 10/02/2026', releaseDate: '2026-10-02' }],
      people: [],
      piEndDate: '2026-11-06',
      hasSubStatusField: true,
      teamProfileId: 'team-a',
    },
    CONFIG,
  );
}

describe('buildScopeCutPlan', () => {
  it('proposes the lowest-ranked Feature first, which is the team own answer', () => {
    const forecast = forecastOf([
      issue({ key: 'HIGH-1', featureKey: 'DENP-1', storyPoints: 5 }),
      issue({ key: 'LOW-1', featureKey: 'DENP-9', storyPoints: 5 }),
    ]);

    const plan = buildScopeCutPlan(forecast, 5, ['HIGH-1', 'LOW-1'], {
      rankByFeatureKey: { 'DENP-1': 1, 'DENP-9': 9 },
    });

    expect(plan.candidates.map((candidate) => candidate.issueKey)).toEqual(['LOW-1']);
  });

  it('takes only as much as the shortfall needs', () => {
    // Proposing everything droppable would be easier and would also be advice nobody could act on.
    const forecast = forecastOf([
      issue({ key: 'A', storyPoints: 5 }),
      issue({ key: 'B', storyPoints: 5 }),
      issue({ key: 'C', storyPoints: 5 }),
    ]);

    const plan = buildScopeCutPlan(forecast, 6, ['A', 'B', 'C'], { rankByFeatureKey: {} });

    expect(plan.candidates).toHaveLength(2);
    expect(plan.recoveredWorkingDays).toBe(10);
  });

  it('counts down the shortfall, so the last item needed is obvious', () => {
    const forecast = forecastOf([issue({ key: 'A', storyPoints: 5 }), issue({ key: 'B', storyPoints: 5 })]);

    const plan = buildScopeCutPlan(forecast, 8, ['A', 'B'], { rankByFeatureKey: {} });

    expect(plan.candidates.map((candidate) => candidate.remainingShortfallWorkingDays)).toEqual([3, 0]);
  });

  it('says plainly when dropping everything still leaves the release short', () => {
    // A plan that closes part of the gap is worth having; presenting it as a solution is not.
    const forecast = forecastOf([issue({ key: 'A', storyPoints: 2 })]);

    const plan = buildScopeCutPlan(forecast, 20, ['A'], { rankByFeatureKey: {} });

    expect(plan.isStillShortAfterCut).toBe(true);
    expect(plan.recoveredWorkingDays).toBe(2);
  });

  it('reports a plan that does close the gap as closing it', () => {
    const forecast = forecastOf([issue({ key: 'A', storyPoints: 9 })]);

    const plan = buildScopeCutPlan(forecast, 5, ['A'], { rankByFeatureKey: {} });

    expect(plan.isStillShortAfterCut).toBe(false);
  });

  it('sorts an unranked Feature LAST, rather than volunteering it first', () => {
    // An unranked Feature is one the board has not been told about. Proposing it for removal on the
    // strength of a gap in configuration would be the tool inventing a priority nobody gave it.
    const forecast = forecastOf([
      issue({ key: 'RANKED', featureKey: 'DENP-9', storyPoints: 5 }),
      issue({ key: 'UNRANKED', featureKey: 'DENP-X', storyPoints: 5 }),
    ]);

    const plan = buildScopeCutPlan(forecast, 5, ['RANKED', 'UNRANKED'], {
      rankByFeatureKey: { 'DENP-9': 9 },
    });

    expect(plan.candidates.map((candidate) => candidate.issueKey)).toEqual(['UNRANKED']);
  });

  it('never proposes work nobody sized, and names it instead', () => {
    // It cannot be weighed, so removing it recovers an unknown amount. Saying so is the only honest
    // option; quietly leaving it out would make the plan look complete when it is not.
    const forecast = forecastOf([issue({ key: 'A', storyPoints: 5 }), issue({ key: 'NOSIZE', storyPoints: null })]);

    const plan = buildScopeCutPlan(forecast, 5, ['A', 'NOSIZE'], { rankByFeatureKey: {} });

    expect(plan.candidates.map((candidate) => candidate.issueKey)).not.toContain('NOSIZE');
    expect(plan.unsizedIssueKeys).toEqual(['NOSIZE']);
  });

  it('never proposes work that is already finished', () => {
    const forecast = forecastOf([issue({ key: 'DONE', storyPoints: 5, isComplete: true })]);

    const plan = buildScopeCutPlan(forecast, 5, ['DONE'], { rankByFeatureKey: {} });

    expect(plan.candidates).toEqual([]);
  });

  it('ignores work outside the release being assessed', () => {
    const forecast = forecastOf([issue({ key: 'IN', storyPoints: 5 }), issue({ key: 'OUT', storyPoints: 5 })]);

    const plan = buildScopeCutPlan(forecast, 20, ['IN'], { rankByFeatureKey: {} });

    expect(plan.candidates.map((candidate) => candidate.issueKey)).toEqual(['IN']);
  });

  it('carries who holds each item, so the conversation has a name attached', () => {
    const forecast = forecastOf([issue({ key: 'A', storyPoints: 5 })]);

    const plan = buildScopeCutPlan(forecast, 5, ['A'], { rankByFeatureKey: {} });

    expect(plan.candidates[0].assigneeDisplayName).toBe('Smith, Jane (CTR)');
  });

  it('proposes nothing when the release already fits', () => {
    const forecast = forecastOf([issue({ key: 'A', storyPoints: 5 })]);

    const plan = buildScopeCutPlan(forecast, 0, ['A'], { rankByFeatureKey: {} });

    expect(plan.candidates).toEqual([]);
    expect(plan.isStillShortAfterCut).toBe(false);
  });
});
