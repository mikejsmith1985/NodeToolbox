// ownershipRule.test.ts — Contract tests for reading stated area sizes from a line and deciding which area
// owns an item's scope, before any AI estimate is asked for (spec 037, contracts/deterministic-rules.md §4).

import { describe, expect, it } from 'vitest';

import type { SourceLine } from './epicIntakeModel.ts';
import {
  decideOwnerFromShare,
  decideOwnerFromSizes,
  ENROLLMENT_OWNS_AT_SHARE,
  FULFILLMENT_OWNS_AT_SHARE,
  parseAreaSizes,
} from './ownershipRule.ts';

/** Builds a minimal SourceLine for a test, with rawText mirroring text unless overridden. */
function buildLine(lineNumber: number, text: string): SourceLine {
  return { lineNumber, text, rawText: text, outlineLevel: 2 };
}

describe('parseAreaSizes', () => {
  it('reads a cost prefix and area after the size', () => {
    expect(parseAreaSizes(buildLine(1, '(1.2M) XL Enrollment'))).toEqual([
      { area: 'Enrollment', canonicalArea: 'enrollment', size: 'XL', cost: '1.2M', lineNumber: 1 },
    ]);
  });

  it('reads an area stated before the size', () => {
    expect(parseAreaSizes(buildLine(1, 'Fulfillment M'))).toEqual([
      { area: 'Fulfillment', canonicalArea: 'fulfillment', size: 'M', cost: null, lineNumber: 1 },
    ]);
  });

  it('reads a non-owning area and reports it uncanonicalized', () => {
    expect(parseAreaSizes(buildLine(1, 'Infra XL'))).toEqual([
      { area: 'Infra', canonicalArea: null, size: 'XL', cost: null, lineNumber: 1 },
    ]);
  });

  it('skips the filler word "size" to find the area', () => {
    expect(parseAreaSizes(buildLine(1, 'Vendor size L'))).toEqual([
      { area: 'Vendor', canonicalArea: null, size: 'L', cost: null, lineNumber: 1 },
    ]);
  });

  it('skips the filler word "dev" and resolves the British spelling alias', () => {
    expect(parseAreaSizes(buildLine(1, 'Fulfilment dev M'))).toEqual([
      { area: 'Fulfilment', canonicalArea: 'fulfillment', size: 'M', cost: null, lineNumber: 1 },
    ]);
  });

  it('never reads the "M" in a cost figure as a size', () => {
    expect(parseAreaSizes(buildLine(1, '(1.2M) Enrollment'))).toEqual([]);
  });

  it('finds nothing in "Large for all" because "Large" is a word, not a size token', () => {
    expect(parseAreaSizes(buildLine(1, 'Large for all'))).toEqual([]);
  });

  it('finds nothing on a line with no size at all', () => {
    expect(parseAreaSizes(buildLine(1, 'Analysis'))).toEqual([]);
  });
});

describe('decideOwnerFromSizes', () => {
  it('gives ownership to the larger stated size', () => {
    const result = decideOwnerFromSizes([
      { area: 'Enrollment', canonicalArea: 'enrollment', size: 'XL', cost: null, lineNumber: 1 },
      { area: 'Fulfillment', canonicalArea: 'fulfillment', size: 'M', cost: null, lineNumber: 2 },
    ]);
    expect(result).toEqual({ owner: 'enrollment', reason: 'Stated sizes: Enrollment XL vs Fulfillment M' });
  });

  it('gives ownership to Fulfillment when its stated size is larger', () => {
    const result = decideOwnerFromSizes([
      { area: 'Enrollment', canonicalArea: 'enrollment', size: 'S', cost: null, lineNumber: 1 },
      { area: 'Fulfillment', canonicalArea: 'fulfillment', size: 'L', cost: null, lineNumber: 2 },
    ]);
    expect(result).toEqual({ owner: 'fulfillment', reason: 'Stated sizes: Enrollment S vs Fulfillment L' });
  });

  it('uses the largest size when an area is stated more than once', () => {
    const result = decideOwnerFromSizes([
      { area: 'Enrollment', canonicalArea: 'enrollment', size: 'S', cost: null, lineNumber: 1 },
      { area: 'Enrollment', canonicalArea: 'enrollment', size: 'XL', cost: null, lineNumber: 2 },
      { area: 'Fulfillment', canonicalArea: 'fulfillment', size: 'M', cost: null, lineNumber: 3 },
    ]);
    expect(result).toEqual({ owner: 'enrollment', reason: 'Stated sizes: Enrollment XL vs Fulfillment M' });
  });

  it('gives ownership to the only area stated', () => {
    const result = decideOwnerFromSizes([
      { area: 'Enrollment', canonicalArea: 'enrollment', size: 'XL', cost: null, lineNumber: 1 },
    ]);
    expect(result).toEqual({ owner: 'enrollment', reason: 'Stated sizes: only Enrollment XL' });
  });

  it('sends equal stated sizes to the PO', () => {
    const result = decideOwnerFromSizes([
      { area: 'Enrollment', canonicalArea: 'enrollment', size: 'M', cost: null, lineNumber: 1 },
      { area: 'Fulfillment', canonicalArea: 'fulfillment', size: 'M', cost: null, lineNumber: 2 },
    ]);
    expect(result).toEqual({ owner: null, reason: 'Stated sizes are equal: Enrollment M vs Fulfillment M' });
  });

  it('falls through when neither owning area is stated', () => {
    const result = decideOwnerFromSizes([
      { area: 'Infra', canonicalArea: null, size: 'XL', cost: null, lineNumber: 1 },
    ]);
    expect(result).toEqual({ owner: undefined, reason: 'No Enrollment or Fulfillment size stated' });
  });

  it('falls through for an empty list', () => {
    expect(decideOwnerFromSizes([])).toEqual({ owner: undefined, reason: 'No Enrollment or Fulfillment size stated' });
  });
});

describe('decideOwnerFromShare', () => {
  it(`gives Enrollment ownership at exactly ${ENROLLMENT_OWNS_AT_SHARE}%`, () => {
    expect(decideOwnerFromShare(60)).toEqual({
      owner: 'enrollment',
      reason: 'Estimated Enrollment share 60% (≥ 60%)',
    });
  });

  it('gives Enrollment ownership above the threshold', () => {
    expect(decideOwnerFromShare(70)).toEqual({
      owner: 'enrollment',
      reason: 'Estimated Enrollment share 70% (≥ 60%)',
    });
  });

  it(`gives Fulfillment ownership at exactly ${FULFILLMENT_OWNS_AT_SHARE}%`, () => {
    expect(decideOwnerFromShare(40)).toEqual({
      owner: 'fulfillment',
      reason: 'Estimated Enrollment share 40% (≤ 40%)',
    });
  });

  it('gives Fulfillment ownership below the threshold', () => {
    expect(decideOwnerFromShare(30)).toEqual({
      owner: 'fulfillment',
      reason: 'Estimated Enrollment share 30% (≤ 40%)',
    });
  });

  it('sends 41% (just above the Fulfillment band) to the PO as a close call', () => {
    expect(decideOwnerFromShare(41)).toEqual({
      owner: null,
      reason: 'Estimated Enrollment share 41% is a close call',
    });
  });

  it('sends 59% (just below the Enrollment band) to the PO as a close call', () => {
    expect(decideOwnerFromShare(59)).toEqual({
      owner: null,
      reason: 'Estimated Enrollment share 59% is a close call',
    });
  });

  it('sends 50% to the PO as a close call', () => {
    expect(decideOwnerFromShare(50)).toEqual({
      owner: null,
      reason: 'Estimated Enrollment share 50% is a close call',
    });
  });

  it('rejects a negative share', () => {
    const result = decideOwnerFromShare(-1);
    expect(result.owner).toBeUndefined();
    expect(result.reason).toContain('-1');
  });

  it('rejects a share above 100', () => {
    const result = decideOwnerFromShare(101);
    expect(result.owner).toBeUndefined();
    expect(result.reason).toContain('101');
  });

  it('rejects a non-integer share', () => {
    const result = decideOwnerFromShare(55.5);
    expect(result.owner).toBeUndefined();
    expect(result.reason).toContain('55.5');
  });

  it('rejects a share sent as a string', () => {
    const result = decideOwnerFromShare('60');
    expect(result.owner).toBeUndefined();
    expect(result.reason).toContain('60');
  });

  it('rejects NaN', () => {
    const result = decideOwnerFromShare(Number.NaN);
    expect(result.owner).toBeUndefined();
  });
});
