// piDeliveryEngine.ts — The PI Delivery Framework orchestrator (spec 032, US2/US3). ADDITIVE to the 028
// engine: it composes the SAME reused pieces (buildCapacityPlan for parallel per-repo assignment + the
// SL-test-as-own-constraint bottleneck; computeItemDates for the INT/REL/PROD cadence) but makes the
// capacity unit the CODING SUB-TASK, so different developers are assigned to different repos of one Story
// and work in parallel. Pure; the clock/calendar are injected → deterministic and unit-testable.

import { buildCapacityPlan } from '../../FeatureCanvas/planner/capacityPlanner.ts';
import type { PersonCapacity, PlanItem, PlanResult, ProjectedSprint } from '../../FeatureCanvas/planner/capacityTypes.ts';
import { mapPriorityToBucket, splitEffort, MAX_STORY_POINTS } from './piPlanBreakdown.ts';
import { computeItemDates, type DateContext } from './piPlanDates.ts';
import { buildRepoCodingSubtasks } from './piPlanRepoSubtasks.ts';
import type {
  DatedItem,
  ExistingChild,
  PiPlanningFactSheet,
  RepoCodingSubtask,
  ScheduledStory,
  WorkingCalendar,
} from './piPlanTypes.ts';

const WORKING_DAYS_PER_WEEK = 5;
const CALENDAR_DAYS_PER_WEEK = 7;
const DEFAULT_SPRINT_LENGTH_DAYS = 14;

/** One Story the AI decomposition proposed: which repos it covers under one primary owner. */
export interface AcceptedStory {
  featureKey: string;
  summary: string;
  sizePoints: number;
  /** The repositories (subset of the Feature's repo components) this Story touches → its coding sub-tasks. */
  repoNames: string[];
  /** False for a spike (all effort is dev, no SL test); defaults true. */
  hasTestableOutput?: boolean;
  existingChildren?: ExistingChild[];
}

export interface DeliveryEngineInput {
  factSheet: PiPlanningFactSheet;
  stories: AcceptedStory[];
  resolveComponentId: (repoName: string) => string | null;
  workingCalendar: WorkingCalendar;
  piEndIso: string;
  todayIso: string;
  sprintLengthDays?: number;
}

/** One fully-planned Story: its parallel coding sub-tasks (with assignees), SL owner, sprint, and dates. */
export interface PlannedStory {
  tempId: string;
  featureKey: string;
  summary: string;
  sizePoints: number;
  codingSubtasks: RepoCodingSubtask[];
  slAssignee: string | null;
  sprintName: string;
  dates: DatedItem;
  warnings: string[];
}

export interface DeliveryPlan {
  stories: PlannedStory[];
  planResult: PlanResult;
  honestStates: string[];
}

/** Working days in one sprint, from its calendar length. */
function workingDaysPerSprint(sprintLengthDays: number): number {
  return Math.max(1, Math.round((sprintLengthDays * WORKING_DAYS_PER_WEEK) / CALENDAR_DAYS_PER_WEEK));
}

/** The team's average points-per-working-day, the velocity basis for converting effort to calendar time. */
function teamRate(people: PersonCapacity[], sprintLengthDays: number): number {
  const average = people.length > 0
    ? people.reduce((sum, person) => sum + person.pointsPerSprint, 0) / people.length
    : 1;
  return Math.max(0.1, average / workingDaysPerSprint(sprintLengthDays));
}

/** Builds the assignee/sprint index over a plan result, keyed by PlanItem key (first placement wins). */
function indexPlacements(sprints: ProjectedSprint[]): Map<string, { sprint: ProjectedSprint; assignee: string }> {
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

/** Keys the coding and SL-test PlanItems for one Story deterministically. */
function codingItemKey(tempId: string, repoIndex: number): string { return `${tempId}:c${repoIndex}`; }
function slItemKey(tempId: string): string { return `${tempId}:sl`; }

/**
 * Builds the full delivery plan: each Story's coding sub-tasks and SL-test become capacity items, so
 * buildCapacityPlan load-balances repos across developers (parallel work) and surfaces SL-test as its own
 * limiting-role bottleneck; dates are then recomputed from the cadence rules. Nothing is trusted from any AI.
 */
export function buildDeliveryPlan(input: DeliveryEngineInput): DeliveryPlan {
  const sprintLengthDays = input.sprintLengthDays ?? DEFAULT_SPRINT_LENGTH_DAYS;
  const people = input.factSheet.people.map((person): PersonCapacity => ({
    displayName: person.displayName,
    roles: person.roles as PersonCapacity['roles'],
    pointsPerSprint: person.pointsPerSprint,
  }));
  const featureByKey = new Map(input.factSheet.features.map((feature) => [feature.key, feature]));

  interface StoryPrep {
    tempId: string; story: AcceptedStory; codingSubtasks: RepoCodingSubtask[];
    devPoints: number; slPoints: number; hasTestableOutput: boolean; bucket: PlanItem['bucket']; rank: number;
    warnings: string[];
  }
  const preps: StoryPrep[] = [];
  const planItems: PlanItem[] = [];
  const honestStates: string[] = [];

  input.stories.forEach((story, storyIndex) => {
    const tempId = `${story.featureKey}#${storyIndex + 1}`;
    const feature = featureByKey.get(story.featureKey);
    const hasTestableOutput = story.hasTestableOutput ?? true;
    const { devPoints, internalTestPoints } = hasTestableOutput
      ? splitEffort(story.sizePoints)
      : { devPoints: story.sizePoints, internalTestPoints: 0 };
    const codingSubtasks = buildRepoCodingSubtasks(
      { summary: story.summary, devPoints },
      story.repoNames,
      input.resolveComponentId,
      story.existingChildren ?? [],
    );
    const warnings: string[] = [];
    if (story.sizePoints > MAX_STORY_POINTS) {
      warnings.push(`Story is ${story.sizePoints} pts, over the ${MAX_STORY_POINTS}-pt cap — split it further`);
    }
    if (codingSubtasks.length === 0) {
      honestStates.push(`Story "${story.summary}" (${story.featureKey}) has no repo components — map repos first.`);
    }
    const bucket = mapPriorityToBucket(feature?.priorityName ?? null, feature?.isCommitted ?? false);
    const rank = feature?.priorityRank ?? storyIndex;

    // One capacity item per coding sub-task (dev work) — this is what enables parallel per-repo assignment.
    codingSubtasks.forEach((codingSubtask, repoIndex) => {
      planItems.push({
        key: codingItemKey(tempId, repoIndex), summary: codingSubtask.repoName, bucket, rankInBucket: rank,
        devPoints: codingSubtask.devPoints, internalTestPoints: 0, externalTestPoints: 0,
        isTestEstimated: false, assignee: null,
      });
    });
    // One capacity item for SL test — its own stream, so SL capacity becomes the limiting-role bottleneck.
    if (hasTestableOutput && internalTestPoints > 0) {
      planItems.push({
        key: slItemKey(tempId), summary: `SL: ${story.summary}`, bucket, rankInBucket: rank,
        devPoints: 0, internalTestPoints, externalTestPoints: 0, isTestEstimated: false, assignee: null,
      });
    }
    preps.push({ tempId, story, codingSubtasks, devPoints, slPoints: internalTestPoints, hasTestableOutput, bucket, rank, warnings });
  });

  const planResult = buildCapacityPlan(
    { items: planItems, people, piName: input.factSheet.piName, sprintLengthDays,
      syntheticTestFraction: 0.3, planStartIso: input.factSheet.piStartIso },
    input.todayIso,
  );
  const placements = indexPlacements(planResult.sprints);
  const rate = teamRate(people, sprintLengthDays);

  const stories: PlannedStory[] = preps.map((prep) => {
    // Assign each coding sub-task from its capacity placement (parallel across repos).
    const assignedCoding = prep.codingSubtasks.map((codingSubtask, repoIndex) => ({
      ...codingSubtask,
      assignee: placements.get(codingItemKey(prep.tempId, repoIndex))?.assignee ?? null,
    }));
    const slPlacement = placements.get(slItemKey(prep.tempId));
    // The Story's sprint window = the earliest sprint any of its children were placed in.
    const childPlacements = [
      ...assignedCoding.map((_, repoIndex) => placements.get(codingItemKey(prep.tempId, repoIndex))),
      slPlacement,
    ].filter((placement): placement is { sprint: ProjectedSprint; assignee: string } => placement != null);
    const earliest = childPlacements.sort((a, b) => a.sprint.startIso.localeCompare(b.sprint.startIso))[0]?.sprint;
    const sprintStartIso = earliest?.startIso ?? input.factSheet.piStartIso;
    const sprintName = earliest?.name ?? (input.factSheet.sprints[0]?.name ?? 'Sprint 1');

    const scheduled: ScheduledStory = {
      tempId: prep.tempId, featureKey: prep.story.featureKey, summary: prep.story.summary,
      sizePoints: prep.story.sizePoints, devPoints: prep.devPoints, internalTestPoints: prep.slPoints,
      hasTestableOutput: prep.hasTestableOutput, assignee: assignedCoding[0]?.assignee ?? null,
      sprintName, sprintStartIso, sprintEndIso: earliest?.endIso ?? '',
    };
    const dateContext: DateContext = {
      calendar: input.workingCalendar, piStartIso: input.factSheet.piStartIso, piEndIso: input.piEndIso,
      releaseSchedule: input.factSheet.releaseSchedule, pointsPerWorkingDay: rate, todayIso: input.todayIso,
    };
    const dates = computeItemDates(scheduled, dateContext);
    const warnings = [...prep.warnings];
    if (dates.targetEndIso > input.factSheet.deliveryDeadlineIso) {
      warnings.push(`Target End (${dates.targetEndIso}) falls after the Sprint-5 Week-1 delivery deadline (${input.factSheet.deliveryDeadlineIso}) — de-scope or split.`);
    }
    return {
      tempId: prep.tempId, featureKey: prep.story.featureKey, summary: prep.story.summary,
      sizePoints: prep.story.sizePoints, codingSubtasks: assignedCoding,
      slAssignee: slPlacement?.assignee ?? null, sprintName, dates, warnings,
    };
  });

  if (planResult.sprintsBeyondPiEnd > 0) {
    honestStates.push(`Scope extends ${planResult.sprintsBeyondPiEnd} sprint(s) beyond the PI end — the team is over-committed.`);
  }
  if (planResult.unschedulableItemKeys.length > 0) {
    honestStates.push(`${planResult.unschedulableItemKeys.length} item(s) could not be scheduled (capacity or role gap).`);
  }

  return { stories, planResult, honestStates: [...input.factSheet.notes, ...honestStates] };
}
