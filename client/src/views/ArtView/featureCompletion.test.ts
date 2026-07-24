// featureCompletion.test.ts — Tests for the shared feature-completion maths.
//
// Extracted from blueprintHierarchy so the Blueprint progress bar and the PI Review carryover estimate
// use one calculation. These pin the weighting so the two surfaces can never drift apart.

import { describe, expect, it } from 'vitest';

import {
  computeCompletionFraction,
  computeCompletionPercent,
  readStoryCompletionWeight,
  type CompletionStoryNode,
} from './featureCompletion.ts';

function node(overrides: Partial<CompletionStoryNode>): CompletionStoryNode {
  return { status: 'To Do', statusCategoryKey: 'new', storyPoints: null, ...overrides };
}

describe('readStoryCompletionWeight', () => {
  it('counts a done-category story fully', () => {
    expect(readStoryCompletionWeight(node({ status: 'Closed', statusCategoryKey: 'done' }))).toBe(1);
  });

  it('counts a delivered (Ready for QA and beyond) story fully even while In Progress', () => {
    expect(readStoryCompletionWeight(node({ status: 'Ready for QA', statusCategoryKey: 'indeterminate' }))).toBe(1);
  });

  it('counts an in-test story as half and an in-development story as a fifth', () => {
    expect(readStoryCompletionWeight(node({ status: 'Testing' }))).toBe(0.5);
    expect(readStoryCompletionWeight(node({ status: 'In Progress' }))).toBe(0.2);
  });

  it('counts a not-started story as zero', () => {
    expect(readStoryCompletionWeight(node({ status: 'To Do' }))).toBe(0);
  });
});

describe('computeCompletionFraction / Percent', () => {
  it('is point-weighted, not a simple average', () => {
    // 8-pt story done, 2-pt story not ⇒ 8/10 = 0.8.
    const stories = [
      node({ status: 'Done', statusCategoryKey: 'done', storyPoints: 8 }),
      node({ status: 'To Do', storyPoints: 2 }),
    ];

    expect(computeCompletionFraction(stories)).toBeCloseTo(0.8, 10);
    expect(computeCompletionPercent(stories)).toBe(80);
  });

  it('gives each unpointed story an equal default weight', () => {
    const stories = [node({ status: 'Done', statusCategoryKey: 'done' }), node({ status: 'To Do' })];

    expect(computeCompletionFraction(stories)).toBeCloseTo(0.5, 10);
  });

  it('is 0 for no stories', () => {
    expect(computeCompletionFraction([])).toBe(0);
    expect(computeCompletionPercent([])).toBe(0);
  });
});
