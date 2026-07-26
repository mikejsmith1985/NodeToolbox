// piPlanAiFetch.test.ts — Assembles the prompt context (FR-001–011 input set) from resolved inputs.

import { describe, expect, it } from 'vitest';

import { assemblePromptContext, defaultRuleConstants } from './piPlanAiFetch.ts';
import type { PersonCapacity } from '../../FeatureCanvas/planner/capacityTypes.ts';
import type { FeatureInput } from './piPlanTypes.ts';

const PEOPLE: PersonCapacity[] = [
  { displayName: 'Dev One', roles: ['dev'], pointsPerSprint: 10 },
  { displayName: 'QA One', roles: ['internalTest'], pointsPerSprint: 8 },
];
const FEATURES: FeatureInput[] = [
  { key: 'ABC-1', summary: 'Login', sizePoints: 8, priorityRank: 1, priorityName: 'High', isCommitted: true, dependencyKeys: ['ABC-2'], targetFixVersion: 'R1', existingChildren: [] },
];

describe('defaultRuleConstants', () => {
  it('encodes the team scheduling rules', () => {
    const rules = defaultRuleConstants();
    expect(rules.maxStoryPoints).toBe(13);
    expect(rules.relWorkingDays).toBe(5);
    expect(rules.definitionOfDone).toBe('code in INT');
  });
});

describe('assemblePromptContext', () => {
  it('sums team capacity and maps roster + features into the prompt shape', () => {
    const context = assemblePromptContext({
      piName: 'PI 26.3', piStartIso: '2026-05-21', piEndIso: '2026-07-29',
      sprints: [{ name: '26.3.1', startIso: '2026-05-21', endIso: '2026-06-03' }],
      workingCalendar: { weekendDays: [0, 6], holidayIsoDates: [] },
      people: PEOPLE, features: FEATURES, releaseSchedule: { entries: [] },
    });
    expect(context.teamPointsPerSprint).toBe(18); // 10 + 8
    expect(context.roster.map((person) => person.displayName)).toEqual(['Dev One', 'QA One']);
    expect(context.features[0].dependencyKeys).toEqual(['ABC-2']);
    expect(context.rules.maxStoryPoints).toBe(13);
  });
});
