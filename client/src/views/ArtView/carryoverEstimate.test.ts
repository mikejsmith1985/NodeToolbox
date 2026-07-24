// carryoverEstimate.test.ts — Tests for the deterministic "points remaining on a carried Feature" estimate.
//
// The model: a Feature is pointed to DoD (Code in Integrated Test), of which internal testing is 30%
// and development 70%. Remaining = (1 − devDone)·0.7·points + (1 − testDone)·0.3·points. The anchor
// case — dev finished, QA untouched → exactly 30% remains — is the one the whole feature was asked for.

import { describe, expect, it } from 'vitest';

import {
  classifyCarryoverChild,
  estimateCarryoverRemainingPoints,
  type CarryoverChildIssue,
} from './carryoverEstimate.ts';

/** A child with only the fields a given test cares about. */
function child(overrides: Partial<CarryoverChildIssue> & { summary: string }): CarryoverChildIssue {
  return { status: 'To Do', statusCategoryKey: 'new', storyPoints: null, ...overrides };
}

describe('classifyCarryoverChild', () => {
  it('reads Dev / SL / QA from the summary', () => {
    expect(classifyCarryoverChild(child({ summary: 'DEV: Glue Changes' }))).toBe('dev');
    expect(classifyCarryoverChild(child({ summary: 'QA: Component test DENP-1' }))).toBe('test');
    expect(classifyCarryoverChild(child({ summary: 'SL sign-off' }))).toBe('test');
  });

  it('falls back to the assignee roster role when the summary is silent', () => {
    expect(classifyCarryoverChild(child({ summary: 'Update mapping', assigneeRoleKind: 'test' }))).toBe('test');
    expect(classifyCarryoverChild(child({ summary: 'Update mapping', assigneeRoleKind: 'dev' }))).toBe('dev');
  });

  it('treats an unclassifiable child as development rather than dropping it', () => {
    expect(classifyCarryoverChild(child({ summary: 'Update mapping' }))).toBe('dev');
  });

  it('does not misfire on "sl" inside an unrelated word', () => {
    expect(classifyCarryoverChild(child({ summary: 'Slice the payload' }))).toBe('dev');
  });
});

describe('estimateCarryoverRemainingPoints — the anchor case', () => {
  it('leaves exactly 30% when development is done and internal testing is untouched', () => {
    const estimate = estimateCarryoverRemainingPoints(40, [
      child({ summary: 'DEV: build', status: 'Done', statusCategoryKey: 'done' }),
      child({ summary: 'QA: test', status: 'To Do', statusCategoryKey: 'new' }),
    ]);

    expect(estimate?.remainingPoints).toBe(12); // 0.30 × 40
    expect(estimate?.devDoneFraction).toBe(1);
    expect(estimate?.testDoneFraction).toBe(0);
  });

  it('leaves the full 30% when a Feature has NO test children at all — the work still must happen', () => {
    const estimate = estimateCarryoverRemainingPoints(40, [
      child({ summary: 'DEV: build', status: 'Done', statusCategoryKey: 'done' }),
    ]);

    expect(estimate?.remainingPoints).toBe(12); // dev fully done, no QA started ⇒ 30% left
  });
});

describe('estimateCarryoverRemainingPoints — partial development', () => {
  it('adds remaining dev work to the 30% when dev children are still open', () => {
    // One dev child done, one to-do ⇒ dev 50% done. Remaining = 0.5·0.7·40 + 1·0.3·40 = 14 + 12 = 26.
    const estimate = estimateCarryoverRemainingPoints(40, [
      child({ summary: 'DEV: part A', status: 'Done', statusCategoryKey: 'done', storyPoints: 5 }),
      child({ summary: 'DEV: part B', status: 'To Do', statusCategoryKey: 'new', storyPoints: 5 }),
      child({ summary: 'QA: test', status: 'To Do', statusCategoryKey: 'new' }),
    ]);

    expect(estimate?.remainingPoints).toBe(26);
  });

  it('point-weights development completion, not a simple count', () => {
    // The big dev child (8 pts) is done, the small one (2 pts) is not ⇒ dev 80% done.
    // Remaining = 0.2·0.7·50 + 1·0.3·50 = 7 + 15 = 22.
    const estimate = estimateCarryoverRemainingPoints(50, [
      child({ summary: 'DEV: big', status: 'Done', statusCategoryKey: 'done', storyPoints: 8 }),
      child({ summary: 'DEV: small', status: 'To Do', statusCategoryKey: 'new', storyPoints: 2 }),
      child({ summary: 'QA: test', status: 'To Do', statusCategoryKey: 'new' }),
    ]);

    expect(estimate?.remainingPoints).toBe(22);
  });

  it('returns near-zero remaining when everything is done', () => {
    const estimate = estimateCarryoverRemainingPoints(40, [
      child({ summary: 'DEV: build', status: 'Done', statusCategoryKey: 'done' }),
      child({ summary: 'QA: test', status: 'Done', statusCategoryKey: 'done' }),
    ]);

    expect(estimate?.remainingPoints).toBe(0);
  });
});

describe('estimateCarryoverRemainingPoints — guards', () => {
  it('returns null for a Feature with no numeric points', () => {
    expect(estimateCarryoverRemainingPoints(null, [])).toBeNull();
    expect(estimateCarryoverRemainingPoints(0, [])).toBeNull();
  });

  it('for a Feature with no children at all, leaves the whole thing remaining', () => {
    // Nothing started ⇒ dev 0% and test 0% ⇒ remaining = full points.
    expect(estimateCarryoverRemainingPoints(40, [])?.remainingPoints).toBe(40);
  });

  it('is pure — identical input gives an identical estimate', () => {
    const children = [child({ summary: 'DEV: x', status: 'Done', statusCategoryKey: 'done' })];

    expect(estimateCarryoverRemainingPoints(40, children)).toEqual(estimateCarryoverRemainingPoints(40, children));
  });
});
