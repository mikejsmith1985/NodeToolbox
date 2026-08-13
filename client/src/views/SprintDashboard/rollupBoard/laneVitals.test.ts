// laneVitals.test.ts — Proves the swimlane header's figures read the same as the sentence they
// replaced, and that an absent figure is stated as absent rather than shown as zero.

import { describe, expect, it } from 'vitest';

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
