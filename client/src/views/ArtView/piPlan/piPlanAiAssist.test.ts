// piPlanAiAssist.test.ts — The {kind:'piPlan'} prompt builder + reply parser (spec 028, US1).

import { describe, expect, it } from 'vitest';

import { buildPiPlanAiPrompt, parsePiPlanAiReply } from './piPlanAiAssist.ts';
import type { PiPlanPromptContext } from './piPlanAiAssist.ts';

const CONTEXT: PiPlanPromptContext = {
  piName: 'PI 26.3',
  piStartIso: '2026-05-21',
  piEndIso: '2026-07-29',
  sprints: [{ name: '26.3.1', startIso: '2026-05-21', endIso: '2026-06-03' }],
  workingCalendar: { weekendDays: [0, 6], holidayIsoDates: [] },
  roster: [{ displayName: 'Dev One', roles: ['dev'], pointsPerSprint: 8 }],
  teamPointsPerSprint: 32,
  features: [
    { key: 'ABC-1', summary: 'Login', sizePoints: 13, priorityName: 'High', dependencyKeys: [], targetFixVersion: 'R1' },
  ],
  releaseSchedule: { entries: [{ name: 'R1', releaseDateIso: '2026-06-15', isSuggested: false }] },
  rules: {
    devTestSplitLabel: '70% development / 30% internal testing',
    maxStoryPoints: 13,
    intWithinHours: 24,
    relWorkingDays: 5,
    keepReleasesMonthly: true,
    definitionOfDone: 'code in INT',
  },
};

describe('buildPiPlanAiPrompt', () => {
  it('carries the full input set and the reply template', () => {
    const prompt = buildPiPlanAiPrompt(CONTEXT);
    expect(prompt).toContain('PI 26.3');
    expect(prompt).toContain('26.3.1'); // sprint calendar
    expect(prompt).toContain('Dev One'); // roster + capabilities
    expect(prompt).toContain('32 points/sprint'); // capacity
    expect(prompt).toContain('ABC-1'); // feature + size
    expect(prompt).toContain('R1 @ 2026-06-15'); // release schedule
    expect(prompt).toContain('70% development / 30% internal testing'); // rule constants
    expect(prompt).toContain('13 points');
    expect(prompt).toContain('5 working days');
    expect(prompt).toContain('"kind":"piPlan"');
  });
});

describe('parsePiPlanAiReply', () => {
  const known = ['ABC-1', 'ABC-2'];

  it('parses a well-formed reply into suggestions in reply order, preserving rationale', () => {
    const reply = JSON.stringify({
      kind: 'piPlan',
      items: [
        { featureKey: 'ABC-1', stories: [{ summary: 'S1', sizePoints: 8, hasTestableOutput: true }], rationale: 'split by flow' },
        { featureKey: 'ABC-2', stories: [{ summary: 'S2', sizePoints: 5 }], rationale: null },
      ],
    });
    const result = parsePiPlanAiReply(reply, known);
    expect(result.suggestions.map((s) => s.featureKey)).toEqual(['ABC-1', 'ABC-2']);
    expect(result.suggestions[0].rationale).toBe('split by flow');
    expect(result.suggestions[1].stories[0].hasTestableOutput).toBe(true); // defaults true when omitted
    expect(result.unparsedCount).toBe(0);
  });

  it('rejects an unknown featureKey and keeps the rest', () => {
    const reply = JSON.stringify({
      kind: 'piPlan',
      items: [
        { featureKey: 'NOPE-9', stories: [{ summary: 'x', sizePoints: 3 }] },
        { featureKey: 'ABC-1', stories: [{ summary: 'ok', sizePoints: 3 }] },
      ],
    });
    const result = parsePiPlanAiReply(reply, known);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].featureKey).toBe('NOPE-9');
    expect(result.suggestions.map((s) => s.featureKey)).toEqual(['ABC-1']);
  });

  it('drops a story missing its size and counts it, keeping siblings', () => {
    const reply = JSON.stringify({
      kind: 'piPlan',
      items: [{ featureKey: 'ABC-1', stories: [{ summary: 'good', sizePoints: 3 }, { summary: 'no size' }] }],
    });
    const result = parsePiPlanAiReply(reply, known);
    expect(result.suggestions[0].stories).toHaveLength(1);
    expect(result.unparsedCount).toBe(1);
  });

  it('ignores any date fields present in the reply', () => {
    const reply = JSON.stringify({
      kind: 'piPlan',
      items: [{ featureKey: 'ABC-1', stories: [{ summary: 'S', sizePoints: 3, targetStartIso: '2026-01-01', dueIso: '2026-02-02' }] }],
    });
    const story = parsePiPlanAiReply(reply, known).suggestions[0].stories[0] as Record<string, unknown>;
    expect(story.targetStartIso).toBeUndefined();
    expect(story.dueIso).toBeUndefined();
  });

  it('throws on a wrong or missing kind', () => {
    expect(() => parsePiPlanAiReply(JSON.stringify({ kind: 'other', items: [] }), known)).toThrow(/piPlan/);
    expect(() => parsePiPlanAiReply('no json here', known)).toThrow();
  });
});
