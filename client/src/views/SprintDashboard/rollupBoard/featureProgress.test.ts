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
