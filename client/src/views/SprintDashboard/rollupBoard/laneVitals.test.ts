// laneVitals.test.ts — Proves the swimlane header's figures read the same as the sentence they
// replaced, and that an absent figure is stated as absent rather than shown as zero.

import { describe, expect, it } from 'vitest';

import type { FeatureDodAssessment } from '../forecast/forecastTypes.ts';
import { buildLaneProgressBar, buildLaneVitalTiles } from './laneVitals.ts';
import type { FamilyProgress, FeatureProgress, MasterCardVitals } from './rollupBoardTypes.ts';

const DEV_PROGRESS: FeatureProgress = {
  percentComplete: 36, basis: 'issue-count', completedUnits: 10, totalUnits: 28,
};

const VITALS: MasterCardVitals = {
  key: 'DENP-1353',
  summary: 'ESI Reconciliation',
  statusName: 'Integrated Test',
  progress: DEV_PROGRESS,
  dependencyCount: 1,
  isFlagged: false,
  storyPoints: 13,
  priorityName: 'Medium',
  childCount: 28,
};

describe('buildLaneProgressBar', () => {
  it('reports the percentage with the basis it was worked out on', () => {
    const bar = buildLaneProgressBar(VITALS, null);

    expect(bar.devPercent).toBe(36);
    expect(bar.devDetail).toBe('10 of 28 by issue count');
  });

  it('names story points as the basis when that is what was counted', () => {
    const bar = buildLaneProgressBar(
      { ...VITALS, progress: { ...DEV_PROGRESS, basis: 'story-points', completedUnits: 0, totalUnits: 6 } },
      null,
    );

    expect(bar.devDetail).toBe('0 of 6 by story points');
  });

  it('says there is nothing to measure rather than drawing an empty bar at zero', () => {
    // A Feature with no work is not a Feature that is 0% done — the bar must not imply it is.
    const bar = buildLaneProgressBar(
      { ...VITALS, progress: { percentComplete: null, basis: 'none', completedUnits: 0, totalUnits: 0 } },
      null,
    );

    expect(bar.devPercent).toBeNull();
    expect(bar.devDetail).toBeNull();
    expect(bar.emptyLabel).toBe('no work to measure yet');
  });

  it('carries no family figure when the Feature has no clones, which is the normal case', () => {
    const bar = buildLaneProgressBar(VITALS, null);

    expect(bar.familyPercent).toBeNull();
    expect(bar.hasDisagreement).toBe(false);
  });

  it('shows the family figure beside the dev figure when other disciplines have cloned it', () => {
    const familyProgress: FamilyProgress = {
      dev: DEV_PROGRESS,
      family: { percentComplete: 39, basis: 'issue-count', completedUnits: 14, totalUnits: 36 },
      hasDisagreement: false,
    };

    const bar = buildLaneProgressBar(VITALS, familyProgress);

    expect(bar.devPercent).toBe(36);
    expect(bar.familyPercent).toBe(39);
    expect(bar.familyDetail).toBe('14 of 36 by issue count');
  });

  it('flags the case worth acting on — dev finished while the family is not', () => {
    const bar = buildLaneProgressBar(VITALS, {
      dev: { percentComplete: 100, basis: 'issue-count', completedUnits: 28, totalUnits: 28 },
      family: { percentComplete: 70, basis: 'issue-count', completedUnits: 28, totalUnits: 40 },
      hasDisagreement: true,
    });

    expect(bar.hasDisagreement).toBe(true);
  });

  it('takes the dev figure from the vitals, so the bar and the tiles cannot disagree', () => {
    // The vitals are computed before any filter is applied. Reading the percentage from anywhere
    // else would let a filtered lane draw a bar that contradicts its own header.
    const familyProgress: FamilyProgress = {
      dev: { percentComplete: 99, basis: 'issue-count', completedUnits: 1, totalUnits: 1 },
      family: null,
      hasDisagreement: false,
    };

    expect(buildLaneProgressBar(VITALS, familyProgress).devPercent).toBe(36);
  });
});

describe('buildLaneVitalTiles', () => {
  it('lays out the Feature\'s vital signs as labelled tiles', () => {
    const tiles = buildLaneVitalTiles(VITALS, { matchedItemCount: 28, totalItemCount: 28, hasActiveFilters: false });

    expect(tiles.map((tile) => tile.id)).toEqual(['status', 'items', 'points', 'priority', 'dependencies']);
    expect(tiles.find((tile) => tile.id === 'status')?.value).toBe('Integrated Test');
    expect(tiles.find((tile) => tile.id === 'points')?.value).toBe('13');
  });

  it('counts both sets while a filter is on, so the tile is never mistaken for the whole Feature', () => {
    const tiles = buildLaneVitalTiles(VITALS, { matchedItemCount: 4, totalItemCount: 28, hasActiveFilters: true });
    const itemsTile = tiles.find((tile) => tile.id === 'items');

    expect(itemsTile?.value).toBe('4 of 28');
    expect(itemsTile?.label).toBe('MATCHING');
  });

  it('says "none" for a figure Jira does not hold, rather than printing a zero that looks measured', () => {
    const tiles = buildLaneVitalTiles(
      { ...VITALS, storyPoints: null, priorityName: null, statusName: null },
      { matchedItemCount: 0, totalItemCount: 0, hasActiveFilters: false },
    );

    expect(tiles.find((tile) => tile.id === 'points')?.value).toBe('None');
    expect(tiles.find((tile) => tile.id === 'points')?.tone).toBe('missing');
    expect(tiles.find((tile) => tile.id === 'priority')?.tone).toBe('missing');
    expect(tiles.find((tile) => tile.id === 'status')?.tone).toBe('missing');
  });

  it('marks dependencies as worth attention only when there are some', () => {
    const withDependency = buildLaneVitalTiles(VITALS, {
      matchedItemCount: 28, totalItemCount: 28, hasActiveFilters: false,
    });
    const withoutDependency = buildLaneVitalTiles({ ...VITALS, dependencyCount: 0 }, {
      matchedItemCount: 28, totalItemCount: 28, hasActiveFilters: false,
    });

    expect(withDependency.find((tile) => tile.id === 'dependencies')?.tone).toBe('alert');
    expect(withoutDependency.find((tile) => tile.id === 'dependencies')?.tone).toBe('normal');
  });

  it('keeps a zero item count as a real zero, because none IS the measurement there', () => {
    const tiles = buildLaneVitalTiles({ ...VITALS, storyPoints: 0 }, {
      matchedItemCount: 0, totalItemCount: 0, hasActiveFilters: false,
    });

    expect(tiles.find((tile) => tile.id === 'items')?.value).toBe('0');
    expect(tiles.find((tile) => tile.id === 'points')?.value).toBe('0');
    expect(tiles.find((tile) => tile.id === 'points')?.tone).toBe('normal');
  });
});

describe('the PI Definition-of-Done tiles', () => {
  // APPENDED. The parameter is optional precisely so every case above keeps passing untouched.

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

  const VITALS: MasterCardVitals = {
    key: 'DENP-1',
    summary: 'A feature',
    statusName: 'Implementing',
    progress: { percentComplete: 50, basis: 'story-points', completedUnits: 5, totalUnits: 10 },
    dependencyCount: 0,
    isFlagged: false,
    storyPoints: 10,
    priorityName: 'High',
    childCount: 3,
  };

  const COUNTS = { matchedItemCount: 3, totalItemCount: 3, hasActiveFilters: false };

  it('draws the same five tiles as ever when no forecast is supplied', () => {
    expect(buildLaneVitalTiles(VITALS, COUNTS)).toHaveLength(5);
  });

  it('adds the two PI tiles when a forecast is supplied', () => {
    const tiles = buildLaneVitalTiles(VITALS, COUNTS, assessment());
    expect(tiles.map((tile) => tile.id)).toEqual([
      'status', 'items', 'points', 'priority', 'dependencies', 'pi-dod', 'dod-date',
    ]);
  });

  it('keeps the PI verdict in its OWN tile rather than folding it into the release figures', () => {
    // The two clocks do not coincide, and merging them is the confusion this exists to end.
    const tiles = buildLaneVitalTiles(VITALS, COUNTS, assessment());
    const piTile = tiles.find((tile) => tile.id === 'pi-dod');
    const pointsTile = tiles.find((tile) => tile.id === 'points');
    expect(piTile?.value).not.toBe(pointsTile?.value);
  });

  it('says READY once every child is at Integration Test', () => {
    const tiles = buildLaneVitalTiles(VITALS, COUNTS, assessment({ intReadyState: 'int-ready' }));
    expect(tiles.find((tile) => tile.id === 'pi-dod')?.value).toBe('Ready');
  });

  it('names WHICH half is at risk, because the two need different conversations', () => {
    const testSqueeze = buildLaneVitalTiles(VITALS, COUNTS, assessment({ piVerdict: 'at-risk', riskCause: 'test-squeeze' }));
    expect(testSqueeze.find((tile) => tile.id === 'pi-dod')?.value).toContain('test squeeze');

    const devTooLarge = buildLaneVitalTiles(VITALS, COUNTS, assessment({ piVerdict: 'at-risk', riskCause: 'dev-too-large' }));
    expect(devTooLarge.find((tile) => tile.id === 'pi-dod')?.value).toContain('dev too large');
  });

  it('carries the alert tone on a Feature at risk, with the words saying so too', () => {
    const tiles = buildLaneVitalTiles(VITALS, COUNTS, assessment({ piVerdict: 'at-risk', riskCause: 'test-squeeze' }));
    const piTile = tiles.find((tile) => tile.id === 'pi-dod');
    expect(piTile?.tone).toBe('alert');
    // Colour is never the only cue: the value alone tells a reader the verdict.
    expect(piTile?.value).toMatch(/at risk/i);
  });

  it('says NO PI END SET rather than judging against a deadline nobody configured', () => {
    const tiles = buildLaneVitalTiles(VITALS, COUNTS, assessment({ piVerdict: 'not-configured' }));
    expect(tiles.find((tile) => tile.id === 'pi-dod')?.value).toBe('No PI end set');
  });

  it('says NOT CHECKED when the instance has no sub-status field', () => {
    const tiles = buildLaneVitalTiles(VITALS, COUNTS, assessment({ intReadyState: 'unknown-sub-status' }));
    expect(tiles.find((tile) => tile.id === 'pi-dod')?.value).toBe('Not checked');
  });

  it('shows the day the Feature can reach Integration Test', () => {
    const tiles = buildLaneVitalTiles(VITALS, COUNTS, assessment());
    expect(tiles.find((tile) => tile.id === 'dod-date')?.value).toBe('2026-09-03');
  });

  it('marks the date absent rather than showing a guess when the chain cannot be dated', () => {
    const tiles = buildLaneVitalTiles(VITALS, COUNTS, assessment({ dodDateIso: null }));
    const dateTile = tiles.find((tile) => tile.id === 'dod-date');
    expect(dateTile?.value).toBe('None');
    expect(dateTile?.tone).toBe('missing');
  });
});
