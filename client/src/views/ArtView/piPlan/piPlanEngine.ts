// piPlanEngine.ts — The pure orchestrator (spec 028, contract planning-engine.md). Expands the accepted
// breakdown, REUSES buildCapacityPlan for scheduling/assignment/capacity, dates each Story via the
// cadence engine, and assembles one PlanProposal whose PlanResult drives BOTH the schedule and the
// capacity map (agree-by-construction). No I/O; the clock is injected → deterministic (SC-003).

import { buildCapacityPlan } from '../../FeatureCanvas/planner/capacityPlanner.ts';
import type { PersonCapacity, PlanItem, PlanResult, ProjectedSprint } from '../../FeatureCanvas/planner/capacityTypes.ts';
import { expandBreakdown, MAX_STORY_POINTS } from './piPlanBreakdown.ts';
import { computeItemDates } from './piPlanDates.ts';
import type { DateContext } from './piPlanDates.ts';
import type {
  DatedItem,
  FeatureInput,
  PlanItemProposal,
  PlanProposal,
  ReleaseSchedule,
  ScheduledStory,
  StorySuggestion,
  SubTaskKind,
  WorkingCalendar,
} from './piPlanTypes.ts';

/** Internal-testing is 30% of a Story's effort (the planner synthesises test cost at this fraction). */
const INTERNAL_TEST_FRACTION = 0.3;
const DEFAULT_SPRINT_LENGTH_DAYS = 14;
const WORKING_DAYS_PER_WEEK = 5;
const CALENDAR_DAYS_PER_WEEK = 7;

/** The self-contained input the engine needs. `acceptedByFeature` maps a Feature key to its accepted Stories. */
export interface PiPlanEngineInput {
  piName: string;
  piStartIso: string;
  piEndIso: string;
  features: FeatureInput[];
  acceptedByFeature: Record<string, StorySuggestion[]>;
  people: PersonCapacity[];
  releaseSchedule: ReleaseSchedule;
  workingCalendar: WorkingCalendar;
  sprintLengthDays?: number;
}

/** Carries the per-Story facts that a bare PlanItem loses, so we can re-hydrate ScheduledStory later. */
interface StoryFacts {
  featureKey: string;
  summary: string;
  sizePoints: number;
  hasTestableOutput: boolean;
  matchExistingKey: string | null;
}

/** The sub-task kinds every Story gets (internal test is added only when the Story is testable). */
const DEPLOY_SUBTASKS: SubTaskKind[] = ['deployInt', 'deployRel', 'deployProd'];

/** Working days in one sprint, from its calendar length. */
function workingDaysPerSprint(sprintLengthDays: number): number {
  return Math.max(1, Math.round((sprintLengthDays * WORKING_DAYS_PER_WEEK) / CALENDAR_DAYS_PER_WEEK));
}

/** Builds a map of item key → the earliest sprint it is scheduled in, plus the person carrying it. */
function indexScheduledItems(sprints: ProjectedSprint[]): Map<string, { sprint: ProjectedSprint; assignee: string }> {
  const index = new Map<string, { sprint: ProjectedSprint; assignee: string }>();
  sprints.forEach((sprint) => {
    sprint.loads.forEach((load) => {
      load.itemKeys.forEach((itemKey) => {
        if (!index.has(itemKey)) {
          index.set(itemKey, { sprint, assignee: load.displayName });
        }
      });
    });
  });
  return index;
}

/** Points-per-working-day for the story's assignee (velocity basis), falling back to the team average. */
function rateForAssignee(assignee: string, people: PersonCapacity[], sprintLengthDays: number): number {
  const person = people.find((candidate) => candidate.displayName === assignee);
  const teamAverage = people.length > 0
    ? people.reduce((sum, candidate) => sum + candidate.pointsPerSprint, 0) / people.length
    : 1;
  const pointsPerSprint = person ? person.pointsPerSprint : teamAverage;
  return Math.max(0.1, pointsPerSprint / workingDaysPerSprint(sprintLengthDays));
}

/** Turns a scheduled PlanItem back into a ScheduledStory with its assignee and sprint window. */
function toScheduledStory(item: PlanItem, facts: StoryFacts, placed: { sprint: ProjectedSprint; assignee: string }): ScheduledStory {
  return {
    tempId: item.key,
    featureKey: facts.featureKey,
    summary: facts.summary,
    sizePoints: facts.sizePoints,
    devPoints: item.devPoints ?? 0,
    internalTestPoints: item.internalTestPoints ?? 0,
    hasTestableOutput: facts.hasTestableOutput,
    assignee: placed.assignee,
    sprintName: placed.sprint.name,
    sprintStartIso: placed.sprint.startIso,
    sprintEndIso: placed.sprint.endIso,
  };
}

/** Builds the Story proposal plus its sub-task proposals from a scheduled story and its dates. */
function buildStoryProposals(story: ScheduledStory, dates: DatedItem, warnings: string[]): PlanItemProposal[] {
  const status = story.assignee && findMatch(story) ? 'existing' : 'new';
  const storyProposal: PlanItemProposal = {
    id: story.tempId,
    kind: 'story',
    status,
    parentKey: story.featureKey,
    payload: story,
    dates,
    warnings,
  };
  const subTaskKinds: SubTaskKind[] = story.hasTestableOutput ? ['internalTest', ...DEPLOY_SUBTASKS] : DEPLOY_SUBTASKS;
  const subTasks = subTaskKinds.map((kind) => ({
    id: `${story.tempId}:${kind}`,
    kind,
    status: 'new' as const,
    parentKey: story.tempId,
    payload: story,
    dates,
    warnings: [],
  }));
  return [storyProposal, ...subTasks];
}

/** A Story is an idempotency match when its accepted suggestion linked to an existing child. */
function findMatch(story: ScheduledStory): boolean {
  return (story as ScheduledStory & { matchExistingKey?: string | null }).matchExistingKey != null;
}

/** Collects the honest states (unsized Features, capability gaps, unscheduled work, over-commitment). */
function collectHonestStates(input: PiPlanEngineInput, planResult: PlanResult, anyTestable: boolean): string[] {
  const states: string[] = [];
  input.features.filter((feature) => feature.sizePoints == null)
    .forEach((feature) => states.push(`Feature ${feature.key} is not sized — cannot be planned until it has a point size`));
  if (anyTestable && !input.people.some((person) => person.roles.includes('internalTest'))) {
    states.push('No roster member has the internal-test capability — testing work cannot be assigned');
  }
  if (planResult.unschedulableItemKeys.length > 0) {
    states.push(`${planResult.unschedulableItemKeys.length} story(ies) could not be scheduled (capacity or role gap)`);
  }
  if (planResult.sprintsBeyondPiEnd > 0) {
    states.push(`Scope extends ${planResult.sprintsBeyondPiEnd} sprint(s) beyond the PI end — the team is over-committed`);
  }
  if (input.releaseSchedule.entries.length === 0) {
    states.push('No production releases fall in the PI window — a monthly cadence will be suggested');
  }
  return states;
}

/**
 * Builds the full PI plan proposal: breakdown → capacity plan (REUSE) → dates → reviewable items, with
 * honest states surfaced and never silently dropped.
 */
export function buildPiPlanProposal(input: PiPlanEngineInput, todayIso: string): PlanProposal {
  const sprintLengthDays = input.sprintLengthDays ?? DEFAULT_SPRINT_LENGTH_DAYS;
  const planItems: PlanItem[] = [];
  const factsByKey = new Map<string, StoryFacts>();
  const warningsByKey = new Map<string, string[]>();

  input.features.forEach((feature) => {
    const accepted = input.acceptedByFeature[feature.key] ?? [];
    const expansion = expandBreakdown(feature, accepted);
    expansion.items.forEach((item, index) => {
      planItems.push(item);
      const story = accepted[index];
      factsByKey.set(item.key, {
        featureKey: feature.key,
        summary: story.summary,
        sizePoints: story.sizePoints,
        hasTestableOutput: story.hasTestableOutput,
        matchExistingKey: story.matchExistingKey,
      });
      warningsByKey.set(item.key, expansion.warnings[item.key] ?? []);
    });
  });

  const planResult = buildCapacityPlan(
    { items: planItems, people: input.people, piName: input.piName, sprintLengthDays, syntheticTestFraction: INTERNAL_TEST_FRACTION, planStartIso: input.piStartIso },
    todayIso,
  );
  const scheduledIndex = indexScheduledItems(planResult.sprints);

  const items: PlanItemProposal[] = [];
  let anyTestable = false;
  planItems.forEach((item) => {
    const facts = factsByKey.get(item.key)!;
    anyTestable = anyTestable || facts.hasTestableOutput;
    const placed = scheduledIndex.get(item.key);
    if (!placed) {
      return; // unschedulable — surfaced via honestStates, never a garbage proposal
    }
    const scheduled = toScheduledStory(item, facts, placed);
    const dateContext: DateContext = {
      calendar: input.workingCalendar,
      piStartIso: input.piStartIso,
      piEndIso: input.piEndIso,
      releaseSchedule: input.releaseSchedule,
      pointsPerWorkingDay: rateForAssignee(placed.assignee, input.people, sprintLengthDays),
      todayIso,
    };
    const dates = computeItemDates(scheduled, dateContext);
    const warnings = [...(warningsByKey.get(item.key) ?? [])];
    if (dates.targetEndIso > input.piEndIso) {
      warnings.push('Code-in-INT (Target End) falls after the PI end — split or de-scope this Story');
    }
    const scheduledWithMatch = Object.assign(scheduled, { matchExistingKey: facts.matchExistingKey });
    items.push(...buildStoryProposals(scheduledWithMatch, dates, warnings));
  });

  return {
    piName: input.piName,
    planResult,
    items,
    releaseSchedule: input.releaseSchedule,
    honestStates: collectHonestStates(input, planResult, anyTestable),
  };
}

export { MAX_STORY_POINTS };
