// piReviewLoad.test.ts — The board-load totals and the comparison to recommended (80%) capacity.

import { describe, expect, it } from 'vitest';

import { computePiReviewLoadComparison } from './piReviewLoad.ts';
import { createEmptyPiReviewRow, type PiReviewRow } from './piReviewTable.ts';

function row(pointEstimate: string, committed: 'Yes' | ''): PiReviewRow {
  const newRow = createEmptyPiReviewRow();
  newRow.pointEstimate = pointEstimate;
  newRow.committed = committed;
  return newRow;
}

describe('computePiReviewLoadComparison', () => {
  it('totals all Features and, separately, only the committed ones', () => {
    const comparison = computePiReviewLoadComparison(
      [row('20', 'Yes'), row('13', 'Yes'), row('8', ''), row('5', '')],
      null,
    );

    expect(comparison.totalFeaturePoints).toBe(46);
    expect(comparison.committedPoints).toBe(33);
  });

  it('treats a blank or non-numeric estimate as zero, not NaN', () => {
    const comparison = computePiReviewLoadComparison([row('', 'Yes'), row('n/a', 'Yes'), row('5', 'Yes')], null);

    expect(comparison.committedPoints).toBe(5);
    expect(comparison.totalFeaturePoints).toBe(5);
  });

  it('reports how committed and total load sit against the 80% target', () => {
    // Target 40: committed 33 is 7 UNDER; total 46 is 6 OVER.
    const comparison = computePiReviewLoadComparison(
      [row('20', 'Yes'), row('13', 'Yes'), row('8', ''), row('5', '')],
      40,
    );

    expect(comparison.capacityTargetPoints).toBe(40);
    expect(comparison.committedVsTarget).toBe(-7);
    expect(comparison.totalVsTarget).toBe(6);
    expect(comparison.committedPercentOfTarget).toBeCloseTo(82.5);
  });

  it('leaves every comparison null when no capacity plan is saved', () => {
    const comparison = computePiReviewLoadComparison([row('20', 'Yes')], null);

    expect(comparison.capacityTargetPoints).toBeNull();
    expect(comparison.committedVsTarget).toBeNull();
    expect(comparison.totalVsTarget).toBeNull();
    expect(comparison.committedPercentOfTarget).toBeNull();
  });

  it('does not divide by zero when the target is zero', () => {
    const comparison = computePiReviewLoadComparison([row('20', 'Yes')], 0);

    expect(comparison.committedVsTarget).toBe(20);
    expect(comparison.committedPercentOfTarget).toBeNull();
  });
});
