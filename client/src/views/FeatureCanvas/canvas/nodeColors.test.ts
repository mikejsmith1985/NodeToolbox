// nodeColors.test.ts — Locks the canvas card colors so the cards and the legend never drift apart.

import { describe, expect, it } from 'vitest';

import { HEALTH_COLORS, STATUS_CATEGORY_COLORS } from './nodeColors.ts';

describe('nodeColors', () => {
  it('maps the in-progress status category to the blue WIP stripe', () => {
    // The legend explains "blue left stripe = in progress"; that promise depends on this value.
    expect(STATUS_CATEGORY_COLORS.indeterminate).toBe('#3b82f6');
    expect(STATUS_CATEGORY_COLORS.new).toBe('#6b7280');
    expect(STATUS_CATEGORY_COLORS.done).toBe('#22c55e');
  });

  it('defines a color for every documented health state', () => {
    expect(Object.keys(HEALTH_COLORS).sort()).toEqual(['blue', 'gray', 'green', 'red', 'yellow']);
  });
});
