// featureSizing.test.ts — Have this Feature's children outgrown the estimate somebody put on it?
//
// Stories are built out through the PI rather than up front, so a mis-sized Feature is only
// discoverable after the fact — and only if something is watching. That is the whole point of this
// check: nobody goes looking for it, so it has to arrive unprompted.
//
// Sub-tasks are excluded deliberately. Their points belong to their parent, and counting both would
// flag every Feature whose team happens to break work down one level further than another's.

import { describe, expect, it } from 'vitest';

import { assessFeatureSizing } from './featureSizing.ts';
import type { SizingChild } from './forecastTypes.ts';

function child(overrides: Partial<SizingChild> = {}): SizingChild {
  return { issueKey: 'ENC-1', typeBucket: 'story', storyPoints: 5, ...overrides };
}

describe('assessFeatureSizing', () => {
  it('flags a Feature estimated at 20 whose children total 34', () => {
    const flag = assessFeatureSizing('DENP-1', 20, [
      child({ issueKey: 'A', storyPoints: 13 }),
      child({ issueKey: 'B', storyPoints: 13 }),
      child({ issueKey: 'C', storyPoints: 8 }),
    ], 0);

    expect(flag.state).toBe('over');
    expect(flag.overagePoints).toBe(14);
    expect(flag.overagePercent).toBe(70);
  });

  it('leaves a Feature whose children match its estimate alone', () => {
    const flag = assessFeatureSizing('DENP-1', 20, [child({ storyPoints: 20 })], 0);
    expect(flag.state).toBe('within');
    expect(flag.overagePoints).toBe(0);
  });

  it('leaves a Feature alone when its overage is inside the configured tolerance', () => {
    const flag = assessFeatureSizing('DENP-1', 20, [child({ storyPoints: 22 })], 20);
    expect(flag.state).toBe('within');
  });

  it('flags a Feature once its overage exceeds the tolerance', () => {
    const flag = assessFeatureSizing('DENP-1', 20, [child({ storyPoints: 26 })], 20);
    expect(flag.state).toBe('over');
    expect(flag.overagePercent).toBe(30);
  });

  it('reports an unsized Feature as NOT SIZED, never as over-size', () => {
    // There is no budget to overrun. Calling it over would be a figure with no basis at all.
    const flag = assessFeatureSizing('DENP-1', null, [child({ storyPoints: 40 })], 0);
    expect(flag.state).toBe('not-sized');
    expect(flag.overagePoints).toBe(0);
    expect(flag.overagePercent).toBe(0);
  });

  it('excludes sub-task points, which belong to their parent', () => {
    // Counting both would flag every Feature whose team breaks work down one level further.
    const flag = assessFeatureSizing('DENP-1', 20, [
      child({ issueKey: 'A', typeBucket: 'story', storyPoints: 15 }),
      child({ issueKey: 'A-1', typeBucket: 'subtask', storyPoints: 15 }),
    ], 0);

    expect(flag.childrenPoints).toBe(15);
    expect(flag.state).toBe('within');
  });

  it('counts defects and tasks alongside stories', () => {
    const flag = assessFeatureSizing('DENP-1', 10, [
      child({ issueKey: 'S', typeBucket: 'story', storyPoints: 5 }),
      child({ issueKey: 'D', typeBucket: 'defect', storyPoints: 5 }),
      child({ issueKey: 'T', typeBucket: 'other', storyPoints: 5 }),
    ], 0);

    expect(flag.childrenPoints).toBe(15);
  });

  it('counts unsized children as nothing and says how many there were', () => {
    // Their absence is why the sum below is a floor rather than a total, and a reader has to know.
    const flag = assessFeatureSizing('DENP-1', 20, [
      child({ issueKey: 'A', storyPoints: 8 }),
      child({ issueKey: 'B', storyPoints: null }),
      child({ issueKey: 'C', storyPoints: null }),
    ], 0);

    expect(flag.childrenPoints).toBe(8);
    expect(flag.unsizedChildCount).toBe(2);
  });

  it('flags a Feature estimated at zero whose children carry points, without an infinite percentage', () => {
    const flag = assessFeatureSizing('DENP-1', 0, [child({ storyPoints: 5 })], 0);
    expect(flag.state).toBe('over');
    expect(flag.overagePoints).toBe(5);
    expect(Number.isFinite(flag.overagePercent)).toBe(true);
  });

  it('treats a Feature with no children as within its estimate', () => {
    const flag = assessFeatureSizing('DENP-1', 20, [], 0);
    expect(flag.childrenPoints).toBe(0);
    expect(flag.state).toBe('within');
  });

  it('rounds the percentage to whole numbers, which is the precision this data has', () => {
    const flag = assessFeatureSizing('DENP-1', 3, [child({ storyPoints: 4 })], 0);
    expect(Number.isInteger(flag.overagePercent)).toBe(true);
  });

  it('carries the Feature key and its own estimate through', () => {
    const flag = assessFeatureSizing('DENP-9', 13, [], 0);
    expect(flag.featureKey).toBe('DENP-9');
    expect(flag.featurePoints).toBe(13);
  });
});
