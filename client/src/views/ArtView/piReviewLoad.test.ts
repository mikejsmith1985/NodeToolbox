// piReviewLoad.test.ts — The board-load totals and the comparison to recommended (80%) capacity.

import { describe, expect, it } from 'vitest';

import { computePiReviewLoadComparison } from './piReviewLoad.ts';
import { createEmptyPiReviewRow, type PiReviewRow } from './piReviewTable.ts';

function row(pointEstimate: string, committed: 'Yes' | '', carryOver: 'Yes' | '' = ''): PiReviewRow {
  const newRow = createEmptyPiReviewRow();
  newRow.pointEstimate = pointEstimate;
  newRow.committed = committed;
  newRow.carryOver = carryOver;
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

  it('sums carryover points from Carry-Over rows and reports them against the 80% target', () => {
    // Two carryover rows (20 + 8 = 28) among the board; target 40 → carryover is 70% of the target.
    const comparison = computePiReviewLoadComparison(
      [row('20', 'Yes', 'Yes'), row('13', 'Yes'), row('8', '', 'Yes'), row('5', '')],
      40,
    );

    expect(comparison.carryOverPoints).toBe(28);
    expect(comparison.carryOverPercentOfTarget).toBeCloseTo(70);
  });

  it('reports zero carryover when no row is flagged Carry-Over', () => {
    const comparison = computePiReviewLoadComparison([row('20', 'Yes'), row('13', 'Yes')], 40);

    expect(comparison.carryOverPoints).toBe(0);
    expect(comparison.carryOverPercentOfTarget).toBe(0);
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
