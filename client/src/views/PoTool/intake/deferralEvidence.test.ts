// deferralEvidence.test.ts — Contract tests for spotting the notes' own words that an item is not current work,
// read only from an item's title line (spec 037, contracts/deterministic-rules.md §3).

import { describe, expect, it } from 'vitest';

import type { SourceLine } from './epicIntakeModel.ts';
import { findDeferralEvidence } from './deferralEvidence.ts';

/** Builds a minimal SourceLine for a test, with rawText mirroring text unless overridden. */
function buildLine(lineNumber: number, text: string): SourceLine {
  return { lineNumber, text, rawText: text, outlineLevel: 1 };
}

describe('findDeferralEvidence', () => {
  it('finds "future conversation" on the title line', () => {
    const evidence = findDeferralEvidence([buildLine(1, 'Mass ID Card Reissue - future conversation')]);
    expect(evidence).toEqual({ phrase: 'future conversation', kind: 'deferred' });
  });

  it('finds "no funding" inside a longer phrase', () => {
    const evidence = findDeferralEvidence([
      buildLine(1, 'Other Transformations (No funding asks/would be funded)'),
    ]);
    expect(evidence).toEqual({ phrase: 'No funding', kind: 'deferred' });
  });

  it('finds "would be funded" when "no funding" is not present', () => {
    const evidence = findDeferralEvidence([buildLine(1, 'Nice to have (would be funded)')]);
    expect(evidence).toEqual({ phrase: 'would be funded', kind: 'deferred' });
  });

  it('finds "rejected" only when it appears inside parentheses', () => {
    const evidence = findDeferralEvidence([buildLine(1, 'ID Card Vendor Change (rejected Idea card)')]);
    expect(evidence).toEqual({ phrase: '(rejected Idea card)', kind: 'deferred' });
  });

  it('does not treat a bare "rejected" outside parentheses as evidence', () => {
    const evidence = findDeferralEvidence([buildLine(1, 'This idea was rejected last quarter')]);
    expect(evidence).toBeNull();
  });

  it('finds the rejected-parenthetical form on the other GH387 line', () => {
    const evidence = findDeferralEvidence([
      buildLine(1, 'Enrollment systems to support off shoring (rejected Idea Card)'),
    ]);
    expect(evidence).toEqual({ phrase: '(rejected Idea Card)', kind: 'deferred' });
  });

  it('treats an item titled exactly "Risks" as risk evidence, case-insensitively', () => {
    expect(findDeferralEvidence([buildLine(1, 'Risks')])).toEqual({ phrase: 'Risks', kind: 'risk' });
    expect(findDeferralEvidence([buildLine(1, '  risks  ')])).toEqual({ phrase: 'risks', kind: 'risk' });
  });

  it('does not match "Risks" as a substring of a longer title', () => {
    const evidence = findDeferralEvidence([buildLine(1, 'Testing Capacity and Risks')]);
    expect(evidence).toBeNull();
  });

  it('ignores evidence that only appears on a sub-line, not the title', () => {
    const evidence = findDeferralEvidence([
      buildLine(1, 'DSNP Module Activation'),
      buildLine(2, 'future conversation needed first'),
    ]);
    expect(evidence).toBeNull();
  });

  it('returns null for an empty line list', () => {
    expect(findDeferralEvidence([])).toBeNull();
  });

  it('returns null when the title carries no deferral phrase', () => {
    expect(findDeferralEvidence([buildLine(1, 'EAM Upgrades')])).toBeNull();
  });
});
