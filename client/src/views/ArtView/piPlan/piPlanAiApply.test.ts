// piPlanAiApply.test.ts — Pure application of an accepted breakdown, incl. idempotency linking (US6 seed).

import { describe, expect, it } from 'vitest';

import { applyBreakdownSuggestion } from './piPlanAiApply.ts';
import type { BreakdownSuggestion, FeatureInput } from './piPlanTypes.ts';

function feature(overrides: Partial<FeatureInput>): FeatureInput {
  return {
    key: 'ABC-1', summary: 'F', sizePoints: 8, priorityRank: 1, priorityName: 'High',
    isCommitted: false, dependencyKeys: [], targetFixVersion: null, existingChildren: [], ...overrides,
  };
}

const suggestion: BreakdownSuggestion = {
  featureKey: 'ABC-1',
  stories: [
    { summary: 'Login form', sizePoints: 5, hasTestableOutput: true, matchExistingKey: null },
    { summary: 'New Story', sizePoints: 3, hasTestableOutput: true, matchExistingKey: null },
  ],
  rationale: null,
};

describe('applyBreakdownSuggestion', () => {
  it('passes size and testability through unchanged', () => {
    const stories = applyBreakdownSuggestion(feature({}), suggestion);
    expect(stories).toHaveLength(2);
    expect(stories[0].sizePoints).toBe(5);
    expect(stories[0].hasTestableOutput).toBe(true);
  });

  it('links a proposed Story to an existing child with a matching summary (idempotency)', () => {
    const withChild = feature({
      existingChildren: [{ key: 'ABC-9', kind: 'story', parentKey: 'ABC-1', summary: 'login form' }],
    });
    const stories = applyBreakdownSuggestion(withChild, suggestion);
    expect(stories[0].matchExistingKey).toBe('ABC-9'); // case/space-insensitive match
    expect(stories[1].matchExistingKey).toBeNull();
  });
});
