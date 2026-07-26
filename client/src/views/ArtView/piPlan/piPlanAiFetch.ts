// piPlanAiFetch.ts — Assembles the AI prompt context (the FR-001–011 input set) from already-resolved
// PI Review data (spec 028, US1). Kept pure so the prompt is unit-testable; the panel supplies the live
// roster/capacity/features/releases and this turns them into the prompt-ready shape.

import type { PersonCapacity } from '../../FeatureCanvas/planner/capacityTypes.ts';
import type { PiPlanPromptContext, PiPlanRuleConstants } from './piPlanAiAssist.ts';
import type { FeatureInput, ReleaseSchedule, WorkingCalendar } from './piPlanTypes.ts';

/** The encoded, non-negotiable scheduling rules sent with every prompt (spec constants). */
export function defaultRuleConstants(): PiPlanRuleConstants {
  return {
    devTestSplitLabel: '70% development / 30% internal testing',
    maxStoryPoints: 13,
    intWithinHours: 24,
    relWorkingDays: 5,
    keepReleasesMonthly: true,
    definitionOfDone: 'code in INT',
  };
}

/** The resolved pieces the panel gathers from the reused stores/reads before assembling the prompt. */
export interface PromptContextInputs {
  piName: string;
  piStartIso: string;
  piEndIso: string;
  sprints: { name: string; startIso: string; endIso: string }[];
  workingCalendar: WorkingCalendar;
  people: PersonCapacity[];
  features: FeatureInput[];
  releaseSchedule: ReleaseSchedule;
}

/** Turns resolved PI Review inputs into the complete prompt context (roster, capacity, features, rules). */
export function assemblePromptContext(inputs: PromptContextInputs): PiPlanPromptContext {
  const teamPointsPerSprint = inputs.people.reduce((sum, person) => sum + person.pointsPerSprint, 0);
  return {
    piName: inputs.piName,
    piStartIso: inputs.piStartIso,
    piEndIso: inputs.piEndIso,
    sprints: inputs.sprints,
    workingCalendar: inputs.workingCalendar,
    roster: inputs.people.map((person) => ({ displayName: person.displayName, roles: person.roles, pointsPerSprint: person.pointsPerSprint })),
    teamPointsPerSprint,
    features: inputs.features.map((feature) => ({
      key: feature.key,
      summary: feature.summary,
      sizePoints: feature.sizePoints,
      priorityName: feature.priorityName,
      dependencyKeys: feature.dependencyKeys,
      targetFixVersion: feature.targetFixVersion,
    })),
    releaseSchedule: inputs.releaseSchedule,
    rules: defaultRuleConstants(),
  };
}
