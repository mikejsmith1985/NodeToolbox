// distributionColours.test.ts — The palette a distribution bar cycles through.

import { describe, expect, it } from 'vitest';

import { readDistributionColour } from './distributionColours.ts';

describe('readDistributionColour', () => {
  it('gives the first two slices clearly different colours', () => {
    // Those are the two a reader looks at, so they are furthest apart in hue.
    expect(readDistributionColour(0)).not.toBe(readDistributionColour(1));
  });

  it('wraps rather than running out when a report has many categories', () => {
    expect(readDistributionColour(99)).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('is stable, so a category keeps its colour between renders', () => {
    expect(readDistributionColour(3)).toBe(readDistributionColour(3));
  });
});
