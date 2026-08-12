// familyProgress.test.ts — Proves a Feature can no longer read as finished while another discipline
// still has open work, and that the existing dev figure keeps meaning exactly what it meant before.

import { describe, expect, it } from 'vitest';

import {
  computeFamilyProgress,
  describeProgressDisagreement,
  haveDifferentBases,
} from './familyProgress.ts';
import { computeFeatureProgress } from './featureProgress.ts';
import type { RollupBoardItem } from './rollupBoardTypes.ts';

/** Builds an item the way the board holds one, with only the fields progress reads. */
function buildItem(key: string, isDone: boolean, storyPoints: number | null = null): RollupBoardItem {
  return {
    key,
    storyPoints,
    issue: { key, fields: { status: { statusCategory: { name: isDone ? 'Done' : 'In Progress' } } } },
  } as unknown as RollupBoardItem;
}

describe('computeFamilyProgress', () => {
  it('reports no family figure when the Feature has no clones', () => {
    // P-01: most lanes on a real board have no clones, and a second identical number is noise.
    const progress = computeFamilyProgress([buildItem('DEV-1', true)], []);

    expect(progress.family).toBeNull();
    expect(progress.hasDisagreement).toBe(false);
  });

  it('leaves the dev figure byte-identical to what the board already computes', () => {
    // The whole reason for two figures rather than one redefined one.
    const devItems = [buildItem('DEV-1', true), buildItem('DEV-2', false)];

    expect(computeFamilyProgress(devItems, [[buildItem('QE-1', false)]]).dev)
      .toEqual(computeFeatureProgress(devItems));
  });

  it('counts every discipline in the family figure', () => {
    const progress = computeFamilyProgress(
      [buildItem('DEV-1', true), buildItem('DEV-2', true)],
      [[buildItem('QE-1', false), buildItem('QE-2', false)]],
    );

    expect(progress.dev.percentComplete).toBe(100);
    expect(progress.family?.percentComplete).toBe(50);
  });

  it('raises the disagreement when dev is done and the family is not', () => {
    // P-02, and the reason this feature exists.
    const progress = computeFamilyProgress([buildItem('DEV-1', true)], [[buildItem('QE-1', false)]]);

    expect(progress.hasDisagreement).toBe(true);
  });

  it('raises no disagreement when everything everywhere is done', () => {
    expect(computeFamilyProgress([buildItem('DEV-1', true)], [[buildItem('QE-1', true)]]).hasDisagreement)
      .toBe(false);
  });

  it('raises no disagreement when dev is not finished either', () => {
    // Two unfinished figures tell nobody anything they did not already know.
    expect(computeFamilyProgress([buildItem('DEV-1', false)], [[buildItem('QE-1', false)]]).hasDisagreement)
      .toBe(false);
  });

  it('still reports a family figure for a discipline that has no work yet', () => {
    // P-05: a discipline with nothing under it is a fact worth showing, not an absence to hide.
    expect(computeFamilyProgress([buildItem('DEV-1', true)], [[]]).family).not.toBeNull();
  });
});

describe('haveDifferentBases', () => {
  it('is false when there is no family figure to compare against', () => {
    expect(haveDifferentBases(computeFamilyProgress([buildItem('DEV-1', true)], []))).toBe(false);
  });

  it('is true when one unpointed clone story demotes the family to counting issues', () => {
    // P-03: "100% and 60%" side by side invites a subtraction that means nothing when the bases differ.
    const progress = computeFamilyProgress(
      [buildItem('DEV-1', true, 5)],
      [[buildItem('QE-1', false, null)]],
    );

    expect(progress.dev.basis).toBe('story-points');
    expect(progress.family?.basis).toBe('issue-count');
    expect(haveDifferentBases(progress)).toBe(true);
  });

  it('is false when both figures weigh the same way', () => {
    const progress = computeFamilyProgress([buildItem('DEV-1', true, 5)], [[buildItem('QE-1', false, 3)]]);

    expect(haveDifferentBases(progress)).toBe(false);
  });
});

describe('describeProgressDisagreement', () => {
  it('says nothing when there is nothing to say', () => {
    expect(describeProgressDisagreement(computeFamilyProgress([buildItem('DEV-1', true)], []))).toBe('');
  });

  it('says the Feature is not done, and how much is left', () => {
    const progress = computeFamilyProgress(
      [buildItem('DEV-1', true)],
      [[buildItem('QE-1', false), buildItem('QE-2', false)]],
    );

    const sentence = describeProgressDisagreement(progress);
    expect(sentence).toContain('Dev is complete, but this Feature is not');
    expect(sentence).toContain('2 issues');
  });

  it('names the unit that matches the basis actually used', () => {
    const progress = computeFamilyProgress([buildItem('DEV-1', true, 5)], [[buildItem('QE-1', false, 3)]]);

    expect(describeProgressDisagreement(progress)).toContain('story points');
  });
});
