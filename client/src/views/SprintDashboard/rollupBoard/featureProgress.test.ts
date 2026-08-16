// featureProgress.test.ts — Proves a percentage is never shown without the basis it was worked out on.
//
// "60% complete" means something very different weighted by points than counted by issues. The basis
// travels with the number so a reader can always check it, and a single missing estimate demotes the
// whole Feature rather than quietly understating a points total.

import { describe, expect, it } from 'vitest';

import { computeFeatureProgress } from './featureProgress.ts';
import type { RollupBoardItem } from './rollupBoardTypes.ts';
import type { JiraIssue } from '../../../types/jira.ts';

/** Builds an item with only the fields progress cares about. */
function buildItem(key: string, statusCategoryName: string, storyPoints: number | null): RollupBoardItem {
  return {
    issue: {
      id: key,
      key,
      fields: { summary: key, status: { name: statusCategoryName, statusCategory: { name: statusCategoryName } } },
    } as unknown as JiraIssue,
    key,
    summary: key,
    typeBucket: 'story',
    typeName: 'Story',
    parentKey: null,
    route: { steps: [], featureKey: 'FEAT-1', precedenceRank: null, unchosenCandidates: [], notes: [] },
    featureKey: 'FEAT-1',
    columnId: '__unmapped__',
    statusName: statusCategoryName,
    subStatusValue: null,
    assigneeAccountId: null,
    assigneeDisplayName: null,
    fixVersionNames: [],
    storyPoints,
    checklistCompletion: null,
    checklistItems: [],
    isFlagged: false,
    impedimentReasons: [],
  };
}

describe('computeFeatureProgress', () => {
  it('weights by story points when every contributing item is estimated', () => {
    const progress = computeFeatureProgress([
      buildItem('DEV-1', 'Done', 6),
      buildItem('DEV-2', 'In Progress', 2),
    ]);

    expect(progress.basis).toBe('story-points');
    expect(progress.completedUnits).toBe(6);
    expect(progress.totalUnits).toBe(8);
    expect(progress.percentComplete).toBe(75);
  });

  it('falls back to counting issues as soon as ONE estimate is missing', () => {
    // A partial points sum silently understates the work, which reads as "we are further behind than
    // we are". Counting issues is cruder but honest, and the basis says which was used.
    const progress = computeFeatureProgress([
      buildItem('DEV-1', 'Done', 6),
      buildItem('DEV-2', 'In Progress', null),
    ]);

    expect(progress.basis).toBe('issue-count');
    expect(progress.completedUnits).toBe(1);
    expect(progress.totalUnits).toBe(2);
    expect(progress.percentComplete).toBe(50);
  });

  it('reports nothing to measure rather than zero percent when the Feature has no items', () => {
    const progress = computeFeatureProgress([]);

    expect(progress.basis).toBe('none');
    expect(progress.percentComplete).toBeNull();
  });

  it('treats an all-estimated but entirely unstarted Feature as zero percent, not as unmeasurable', () => {
    const progress = computeFeatureProgress([buildItem('DEV-1', 'To Do', 5)]);

    expect(progress.percentComplete).toBe(0);
    expect(progress.basis).toBe('story-points');
  });

  it('counts a Feature whose work is all done as one hundred percent', () => {
    const progress = computeFeatureProgress([buildItem('DEV-1', 'Done', 5), buildItem('DEV-2', 'Done', 5)]);

    expect(progress.percentComplete).toBe(100);
  });

  it('falls back to counting when every item is estimated at zero, so no division by zero occurs', () => {
    const progress = computeFeatureProgress([buildItem('DEV-1', 'Done', 0), buildItem('DEV-2', 'To Do', 0)]);

    expect(progress.basis).toBe('issue-count');
    expect(progress.percentComplete).toBe(50);
  });

  it('always returns the basis alongside the number, so it cannot be displayed without it', () => {
    const progress = computeFeatureProgress([buildItem('DEV-1', 'Done', 3)]);

    expect(progress).toHaveProperty('basis');
    expect(progress).toHaveProperty('percentComplete');
  });
});

describe('part credit — work that is under way is worth more than work that is not', () => {
  const COLUMNS = ['col-todo', 'col-working', 'col-review', 'col-done'];

  /** The file's own builder, placed in a column. */
  function buildInColumn(
    key: string,
    columnId: string,
    storyPoints: number | null = null,
    statusCategoryName = 'In Progress',
  ): RollupBoardItem {
    return { ...buildItem(key, statusCategoryName, storyPoints), columnId };
  }

  it('gives a story in the middle of the board a share of the credit', () => {
    // Every unfinished item counted zero before this, so moving a card across the board changed
    // nothing at all until it reached the end.
    const progress = computeFeatureProgress([buildInColumn('DEV-1', 'col-working')], COLUMNS);

    expect(progress.percentComplete).toBe(33);
    expect(progress.basis).toBe('issue-count-part-credit');
  });

  it('gives an untouched story in the first column nothing', () => {
    expect(computeFeatureProgress([buildInColumn('DEV-1', 'col-todo')], COLUMNS).percentComplete).toBe(0);
  });

  it('gives unplaced work nothing, rather than guessing where it got to', () => {
    expect(computeFeatureProgress([buildInColumn('DEV-1', 'unmapped')], COLUMNS).percentComplete).toBe(0);
  });

  it('weights by SIZE as well as position, so a big story near the end outweighs a small new one', () => {
    // The ask exactly: a large story in Code Review should not count the same as a small story
    // nobody has started.
    const progress = computeFeatureProgress([
      buildInColumn('BIG-1', 'col-review', 13),
      buildInColumn('SMALL-1', 'col-todo', 1),
    ], COLUMNS);

    // 13 points at two-thirds credit out of 14 points total.
    expect(progress.percentComplete).toBe(62);
    expect(progress.basis).toBe('story-points-part-credit');
  });

  it('still counts a finished item in full, wherever its column sits', () => {
    const progress = computeFeatureProgress([buildInColumn('DEV-1', 'col-todo', null, 'Done')], COLUMNS);

    expect(progress.percentComplete).toBe(100);
  });

  it('behaves exactly as before when the caller has no columns to give', () => {
    // Adopting this late must not silently change what a Feature appears to be worth.
    const progress = computeFeatureProgress([buildInColumn('DEV-1', 'col-working')]);

    expect(progress.percentComplete).toBe(0);
    expect(progress.basis).toBe('issue-count');
  });
});
