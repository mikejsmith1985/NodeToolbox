// piPlanAiAssist.test.ts — The {kind:'piPlan'} prompt builder + reply parser (spec 028, US1).

import { describe, expect, it } from 'vitest';

import { buildPiPlanAiFollowUpPrompt, buildPiPlanAiPrompt, parsePiPlanAiReply } from './piPlanAiAssist.ts';
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
    expect(prompt).not.toContain('"kind"');
  });

  it('ends with a Story table listing every Feature once, its key and summary filled in (GH #499)', () => {
    const prompt = buildPiPlanAiPrompt({
      ...CONTEXT,
      features: [...CONTEXT.features, { ...CONTEXT.features[0], key: 'ABC-2', summary: 'Card | wallet' }],
    });
    expect(prompt.split('\n').slice(-4)).toEqual([
      'PI_PLAN_STORIES:',
      'Feature key | Feature | Story | Story points | Testable output | Why this split',
      'ABC-1 | Login | ___ | ___ | ___ | ___',
      'ABC-2 | Card   wallet | ___ | ___ | ___ | ___',
    ]);
    expect(prompt).toMatch(/Copy its row once per Story/);
  });
});

// ── Google AI Mode replies (GH #499) ──

const AI_MODE_REPLY = [
  'Here is the Story breakdown for the PI, based on the Features you listed.',
  '',
  '| Feature key | Feature | Story | Story points | Testable output | Why this split |',
  '|---|---|---|---|---|---|',
  '| **ABC-1** | Login | Login form | 5 | Yes | Split by flow. |',
  '| ABC-1 | Login | Login spike | 3 | No | ___ |',
  '| ABC-2 | Logout | Logout button | 8 | Yes | One flow. |',
  '',
  'If you share the acceptance criteria, I can refine the sizes.',
].join('\n');

describe('parsePiPlanAiReply with an AI Mode reply', () => {
  const known = ['ABC-1', 'ABC-2'];

  it('groups a markdown table wrapped in an intro and a closing offer into the same suggestions', () => {
    const result = parsePiPlanAiReply(AI_MODE_REPLY, known);
    expect(result.suggestions).toEqual([
      {
        featureKey: 'ABC-1', rationale: 'Split by flow.', stories: [
          { summary: 'Login form', sizePoints: 5, hasTestableOutput: true, matchExistingKey: null },
          { summary: 'Login spike', sizePoints: 3, hasTestableOutput: false, matchExistingKey: null },
        ],
      },
      { featureKey: 'ABC-2', rationale: 'One flow.', stories: [{ summary: 'Logout button', sizePoints: 8, hasTestableOutput: true, matchExistingKey: null }] },
    ]);
  });

  it('reads a table pasted from the web page as tab-separated cells', () => {
    const tabReply = 'Feature key\tStory\tStory points\nABC-1\tLogin form\t5';
    const result = parsePiPlanAiReply(tabReply, known);
    expect(result.suggestions[0].stories).toEqual([{ summary: 'Login form', sizePoints: 5, hasTestableOutput: true, matchExistingKey: null }]);
  });

  it('still rejects a Feature the table invented, and counts a Story with no points', () => {
    const result = parsePiPlanAiReply('Feature key | Story | Story points\nNOPE-9 | Ghost | 3\nABC-1 | No size | ___', known);
    expect(result.rejected.map((rejection) => rejection.featureKey)).toEqual(['NOPE-9']);
    expect(result.unparsedCount).toBe(1);
  });
});

describe('buildPiPlanAiFollowUpPrompt', () => {
  const context = { ...CONTEXT, features: [...CONTEXT.features, { ...CONTEXT.features[0], key: 'ABC-2', summary: 'Logout' }] };

  it('offers nothing when every Feature got a usable Story', () => {
    expect(buildPiPlanAiFollowUpPrompt(context, parsePiPlanAiReply(AI_MODE_REPLY, ['ABC-1', 'ABC-2']))).toBe('');
  });

  it('asks for the whole table again when the reply could not be read', () => {
    const followUp = buildPiPlanAiFollowUpPrompt(context, null);
    expect(followUp).toMatch(/^Your last reply was not in the form I need/);
    expect(followUp).toContain('ABC-1 | Login | ___');
    expect(followUp).toContain('ABC-2 | Logout | ___');
  });

  it('asks for only the Features left without a usable Story — never guessing them', () => {
    const partial = parsePiPlanAiReply('Feature key | Story | Story points\nABC-1 | Login form | 5\nABC-2 | ___ | ___', ['ABC-1', 'ABC-2']);
    const followUp = buildPiPlanAiFollowUpPrompt(context, partial);
    expect(followUp).toContain('no usable Story for ABC-2');
    expect(followUp).toContain('ABC-2 | Logout | ___');
    expect(followUp).not.toContain('ABC-1 | Login |');
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
    const story = parsePiPlanAiReply(reply, known).suggestions[0].stories[0] as unknown as Record<string, unknown>;
    expect(story.targetStartIso).toBeUndefined();
    expect(story.dueIso).toBeUndefined();
  });

  it('throws on a wrong or missing kind', () => {
    expect(() => parsePiPlanAiReply(JSON.stringify({ kind: 'other', items: [] }), known)).toThrow(/piPlan/);
    expect(() => parsePiPlanAiReply('no json here', known)).toThrow();
  });
});
