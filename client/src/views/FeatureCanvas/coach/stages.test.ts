// stages.test.ts — Verifies the coaching stage definitions and lookup.

import { describe, expect, it } from 'vitest';

import { COACH_STAGES, findStage } from './stages.ts';

describe('coach stages', () => {
  it('defines exactly the five recovery stages in order', () => {
    expect(COACH_STAGES.map((stage) => stage.id)).toEqual(['surface', 'stabilize', 'prioritize', 'size', 'sequence']);
    expect(COACH_STAGES.map((stage) => stage.order)).toEqual([1, 2, 3, 4, 5]);
  });

  it('gives every stage a job, decision, and output and never references AI', () => {
    for (const stage of COACH_STAGES) {
      expect(stage.job).toBeTruthy();
      expect(stage.decision).toBeTruthy();
      expect(stage.output).toBeTruthy();
      const combinedText = `${stage.job} ${stage.decision} ${stage.output}`.toLowerCase();
      expect(combinedText).not.toMatch(/\bai\b/);
      expect(combinedText).not.toContain('copilot');
    }
  });

  it('looks up a stage by id and falls back to the first stage', () => {
    expect(findStage('size').title).toBe('Size');
    expect(findStage('surface')).toBe(COACH_STAGES[0]);
  });
});
