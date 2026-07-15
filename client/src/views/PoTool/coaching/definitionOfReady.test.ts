// definitionOfReady.test.ts — Proves the DoR coaching is deterministic, advisory, and gate-free
// (FR-026, FR-029, SC-013).

import { describe, expect, it, vi } from 'vitest';

import { DEFINITION_OF_READY, FEATURE_WRITING_TIPS, findReadinessCriterion } from './definitionOfReady';

describe('DEFINITION_OF_READY', () => {
  it('covers the readiness bar rather than one or two token points', () => {
    expect(DEFINITION_OF_READY.length).toBeGreaterThanOrEqual(6);
  });

  it('gives every criterion a stable, unique id', () => {
    const criterionIds = DEFINITION_OF_READY.map((criterion) => criterion.id);

    expect(new Set(criterionIds).size).toBe(criterionIds.length);
    criterionIds.forEach((criterionId) => expect(criterionId).toMatch(/^[a-z-]+$/));
  });

  it('explains each criterion and asks a question about YOUR Feature', () => {
    // A bare label teaches nothing; the question is what makes a PO look at their own draft.
    DEFINITION_OF_READY.forEach((criterion) => {
      expect(criterion.name.length).toBeGreaterThan(0);
      expect(criterion.description.length).toBeGreaterThan(20);
      expect(criterion.prompt.length).toBeGreaterThan(10);
    });
  });

  it('covers the things a Feature is most often missing', () => {
    const criterionIds = DEFINITION_OF_READY.map((criterion) => criterion.id);

    expect(criterionIds).toContain('problem');
    expect(criterionIds).toContain('value');
    expect(criterionIds).toContain('acceptance');
    expect(criterionIds).toContain('dependencies');
  });

  it('leads with the problem, because a Feature that opens with the solution hides its reasoning', () => {
    expect(DEFINITION_OF_READY[0].id).toBe('problem');
  });
});

describe('findReadinessCriterion', () => {
  it('finds a criterion by id', () => {
    expect(findReadinessCriterion('value')?.name).toBeTruthy();
  });

  it('returns nothing for an unknown id rather than throwing', () => {
    expect(findReadinessCriterion('nope')).toBeNull();
  });
});

describe('FEATURE_WRITING_TIPS', () => {
  it('offers concrete wording advice', () => {
    expect(FEATURE_WRITING_TIPS.length).toBeGreaterThanOrEqual(3);
    FEATURE_WRITING_TIPS.forEach((tip) => expect(tip.length).toBeGreaterThan(30));
  });
});

describe('determinism (SC-013)', () => {
  it('resolves with no network call', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    findReadinessCriterion('value');
    expect(DEFINITION_OF_READY.length).toBeGreaterThan(0);

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('never mentions the AI assist, so it reads the same locked or unlocked', () => {
    const allCoachingText = [
      ...DEFINITION_OF_READY.map((criterion) => `${criterion.name} ${criterion.description} ${criterion.prompt}`),
      ...FEATURE_WRITING_TIPS,
    ].join(' ');

    expect(allCoachingText).not.toMatch(/\bAI\b|assistant|unlock/i);
  });
});
