// piPlanBreakdown.test.ts — 70/30 split, MoSCoW mapping (research R2a), and the 13-pt cap warning.

import { describe, expect, it } from 'vitest';

import { expandBreakdown, mapPriorityToBucket, splitEffort } from './piPlanBreakdown.ts';
import type { FeatureInput, StorySuggestion } from './piPlanTypes.ts';

function feature(overrides: Partial<FeatureInput>): FeatureInput {
  return {
    key: 'ABC-1', summary: 'F', sizePoints: 20, priorityRank: 1, priorityName: 'High',
    isCommitted: false, dependencyKeys: [], targetFixVersion: null, existingChildren: [], ...overrides,
  };
}

function story(overrides: Partial<StorySuggestion>): StorySuggestion {
  return { summary: 'S', sizePoints: 8, hasTestableOutput: true, matchExistingKey: null, ...overrides };
}

describe('mapPriorityToBucket', () => {
  it('maps priority names to MoSCoW buckets', () => {
    expect(mapPriorityToBucket('Highest', false)).toBe('Must');
    expect(mapPriorityToBucket('High', false)).toBe('Should');
    expect(mapPriorityToBucket('Medium', false)).toBe('Could');
    expect(mapPriorityToBucket('Low', false)).toBe('Wont');
    expect(mapPriorityToBucket(null, false)).toBe('Should'); // unknown → Should
  });

  it('bumps a committed Feature to at least Should', () => {
    expect(mapPriorityToBucket('Low', true)).toBe('Should');
    expect(mapPriorityToBucket('Medium', true)).toBe('Should');
    expect(mapPriorityToBucket('Highest', true)).toBe('Must'); // never demotes
  });
});

describe('splitEffort', () => {
  it('splits 70/30 and always preserves the sum', () => {
    expect(splitEffort(13)).toEqual({ devPoints: 9, internalTestPoints: 4 });
    expect(splitEffort(8)).toEqual({ devPoints: 6, internalTestPoints: 2 });
    expect(splitEffort(5)).toEqual({ devPoints: 4, internalTestPoints: 1 });
    for (const size of [1, 3, 5, 8, 13, 21]) {
      const { devPoints, internalTestPoints } = splitEffort(size);
      expect(devPoints + internalTestPoints).toBe(size);
    }
  });
});

describe('expandBreakdown', () => {
  it('emits planner items with the split and the Feature bucket, and warns on oversize', () => {
    const expansion = expandBreakdown(feature({ priorityName: 'Highest' }), [
      story({ sizePoints: 8 }),
      story({ sizePoints: 21 }), // over the 13-pt cap
    ]);
    expect(expansion.items).toHaveLength(2);
    expect(expansion.items[0].bucket).toBe('Must');
    expect(expansion.items[0].devPoints).toBe(6);
    expect(expansion.items[0].internalTestPoints).toBe(2);
    expect(expansion.warnings['ABC-1#2'][0]).toMatch(/over the 13-pt cap/);
  });

  it('puts all effort into dev with no test for a non-testable (spike) story', () => {
    const expansion = expandBreakdown(feature({}), [story({ hasTestableOutput: false, sizePoints: 5 })]);
    expect(expansion.items[0].devPoints).toBe(5);
    expect(expansion.items[0].internalTestPoints).toBe(0);
  });
});
