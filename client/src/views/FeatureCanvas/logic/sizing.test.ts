// sizing.test.ts — Verifies t-shirt sizing and effective-points resolution.

import { describe, expect, it } from 'vitest';

import { pointsForSize, resolveEffectivePoints, TSHIRT_SIZES } from './sizing.ts';

describe('sizing', () => {
  it('maps the default feature-sizing scale (XS10/S20/M40/L60/XL80/XXL100)', () => {
    expect(TSHIRT_SIZES.map((size) => pointsForSize(size))).toEqual([10, 20, 40, 60, 80, 100]);
  });

  it('honors an edited size mapping', () => {
    expect(pointsForSize('M', { XS: 5, S: 10, M: 20, L: 40, XL: 60, XXL: 80 })).toBe(20);
  });

  it('falls back to the default when an edited mapping value is invalid', () => {
    expect(pointsForSize('L', { XS: 10, S: 20, M: 40, L: Number.NaN, XL: 80, XXL: 100 })).toBe(60);
  });

  it('uses the overlay size when a node is sized', () => {
    expect(resolveEffectivePoints('XL', null)).toBe(80);
  });

  it('uses live story points when the node is unsized', () => {
    expect(resolveEffectivePoints(null, 13)).toBe(13);
  });

  it('contributes zero when the node is neither sized nor pointed', () => {
    expect(resolveEffectivePoints(null, null)).toBe(0);
  });
});
