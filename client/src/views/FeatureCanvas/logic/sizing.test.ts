// sizing.test.ts — Verifies t-shirt sizing and effective-points resolution.

import { describe, expect, it } from 'vitest';

import { pointsForSize, resolveEffectivePoints, TSHIRT_SIZES } from './sizing.ts';

describe('sizing', () => {
  it('maps the default t-shirt scale to S1/M3/L5/XL8', () => {
    expect(TSHIRT_SIZES.map((size) => pointsForSize(size))).toEqual([1, 3, 5, 8]);
  });

  it('honors an edited size mapping', () => {
    expect(pointsForSize('M', { S: 2, M: 4, L: 8, XL: 16 })).toBe(4);
  });

  it('falls back to the default when an edited mapping value is invalid', () => {
    expect(pointsForSize('L', { S: 1, M: 3, L: Number.NaN, XL: 8 })).toBe(5);
  });

  it('uses the overlay size when a node is sized', () => {
    expect(resolveEffectivePoints('XL', null)).toBe(8);
  });

  it('uses live story points when the node is unsized', () => {
    expect(resolveEffectivePoints(null, 13)).toBe(13);
  });

  it('contributes zero when the node is neither sized nor pointed', () => {
    expect(resolveEffectivePoints(null, null)).toBe(0);
  });
});
