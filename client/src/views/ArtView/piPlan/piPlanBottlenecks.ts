// piPlanBottlenecks.ts — Deterministic bottleneck detection (spec 032, US4, contract bottleneck-detection.md).
//
// The engine flags bottlenecks with hard figures; the AI may only ATTACH a mitigation to a flagged one. The
// primary constraint — SL-test throughput — is REUSED from the capacity planner's own BottleneckReport
// (limitingRole === 'internalTest'), so it can never disagree with the schedule it describes. The other
// checks (key-person, dependency ordering, PROD-carry) are computed here from the fact sheet + plan.

import type { PlanResult } from '../../FeatureCanvas/planner/capacityTypes.ts';
import type { PlannedStory } from './piDeliveryEngine.ts';
import type { Bottleneck, PiPlanningFactSheet } from './piPlanTypes.ts';

/** The delivery roles we check for single-owner (key-person) risk. */
const KEY_PERSON_ROLES = ['dev', 'internalTest'] as const;

/** Builds a sprint-name → order-index map so dependency ordering can be compared. */
function sprintIndexByName(factSheet: PiPlanningFactSheet): Map<string, number> {
  const index = new Map<string, number>();
  factSheet.sprints.forEach((sprint, order) => index.set(sprint.name, order));
  return index;
}

/** Flags the SL-test throughput constraint by reusing the planner's already-computed limiting-role report. */
function slThroughputBottleneck(planResult: PlanResult): Bottleneck[] {
  if (planResult.bottleneck.limitingRole !== 'internalTest') {
    return [];
  }
  return [{
    id: 'sl-throughput',
    kind: 'slTestThroughput',
    sprintName: null,
    subjectKey: 'SL test',
    figures: {
      additionalToMatchThroughput: planResult.bottleneck.additionalToMatchThroughput,
      additionalToFinishByPiEnd: planResult.bottleneck.additionalToFinishByPiEnd,
    },
    statement: planResult.bottleneck.statement || 'SL testing is the limiting role — dev output outpaces SL-test capacity.',
    mitigation: null,
  }];
}

/** Flags any delivery role staffed by exactly one capable person (the "one shift-left tester" risk). */
function keyPersonBottlenecks(factSheet: PiPlanningFactSheet): Bottleneck[] {
  return KEY_PERSON_ROLES.flatMap((role) => {
    const capable = factSheet.people.filter((person) => person.roles.includes(role));
    if (capable.length !== 1) {
      return [];
    }
    return [{
      id: `key-person-${role}`,
      kind: 'keyPerson' as const,
      sprintName: null,
      subjectKey: role,
      figures: { capableCount: 1 },
      statement: `Only ${capable[0].displayName} can perform ${role === 'internalTest' ? 'SL test' : role} — a single-owner serialization risk.`,
      mitigation: null,
    }];
  });
}

/** Flags a Story scheduled before a Feature dependency that lands in a later sprint (ordering violation). */
function dependencyOrderBottlenecks(factSheet: PiPlanningFactSheet, stories: PlannedStory[]): Bottleneck[] {
  const order = sprintIndexByName(factSheet);
  const featureByKey = new Map(factSheet.features.map((feature) => [feature.key, feature]));
  const earliestSprintByFeature = new Map<string, number>();
  stories.forEach((story) => {
    const sprintOrder = order.get(story.sprintName) ?? Number.MAX_SAFE_INTEGER;
    const current = earliestSprintByFeature.get(story.featureKey) ?? Number.MAX_SAFE_INTEGER;
    earliestSprintByFeature.set(story.featureKey, Math.min(current, sprintOrder));
  });

  const flags: Bottleneck[] = [];
  stories.forEach((story) => {
    const storyOrder = order.get(story.sprintName) ?? Number.MAX_SAFE_INTEGER;
    const dependencyKeys = featureByKey.get(story.featureKey)?.dependencyKeys ?? [];
    dependencyKeys.forEach((dependencyKey) => {
      const dependencyOrder = earliestSprintByFeature.get(dependencyKey);
      if (dependencyOrder !== undefined && dependencyOrder > storyOrder) {
        flags.push({
          id: `dependency-${story.tempId}-${dependencyKey}`,
          kind: 'dependencyOrder',
          sprintName: story.sprintName,
          subjectKey: story.tempId,
          figures: { storySprint: storyOrder, dependencySprint: dependencyOrder },
          statement: `${story.featureKey} is scheduled before its dependency ${dependencyKey}, which lands in a later sprint.`,
          mitigation: null,
        });
      }
    });
  });
  return flags;
}

/**
 * Flags any Story larger than one person can deliver in a sprint (the selected per-person-per-sprint capacity).
 * A Story over the cap was not decomposed into enough distinct, sprint-fittable slices — it must be split so it
 * can actually land on time. Deterministic: the size comes from the engine's even split, never from the AI.
 */
function storyOversizeBottlenecks(stories: PlannedStory[], maxStorySize: number): Bottleneck[] {
  if (maxStorySize <= 0) {
    return [];
  }
  return stories
    .filter((story) => story.sizePoints > maxStorySize)
    .map((story) => ({
      id: `story-oversize-${story.tempId}`,
      kind: 'storyOversize' as const,
      sprintName: story.sprintName,
      subjectKey: story.tempId,
      figures: { sizePoints: story.sizePoints, maxStorySize },
      statement: `Story "${story.summary}" (${story.featureKey}) is ${story.sizePoints} pts — over the ${maxStorySize}-pt per-sprint capacity. Split it into smaller Stories with distinct deliverables.`,
      mitigation: null,
    }));
}

/** Flags Stories whose production delivery (Due) falls after the PI end — carry vs in-PI. */
function prodCarryBottlenecks(stories: PlannedStory[], piEndIso: string): Bottleneck[] {
  return stories
    .filter((story) => story.dates.dueIso != null && story.dates.dueIso > piEndIso)
    .map((story) => ({
      id: `prod-carry-${story.tempId}`,
      kind: 'prodCarry' as const,
      sprintName: story.sprintName,
      subjectKey: story.tempId,
      figures: {},
      statement: `${story.featureKey} reaches production on ${story.dates.dueIso}, after the PI end (${piEndIso}) — it carries.`,
      mitigation: null,
    }));
}

/**
 * Detects every bottleneck deterministically, in a stable order (SL throughput, key-person, dependency,
 * PROD-carry). Each `id` is stable so an AI mitigation can reference it. No AI is involved.
 */
export function detectBottlenecks(
  planResult: PlanResult,
  factSheet: PiPlanningFactSheet,
  stories: PlannedStory[],
  piEndIso: string,
  maxStorySize = 0,
): Bottleneck[] {
  return [
    ...slThroughputBottleneck(planResult),
    ...keyPersonBottlenecks(factSheet),
    ...dependencyOrderBottlenecks(factSheet, stories),
    ...prodCarryBottlenecks(stories, piEndIso),
    ...storyOversizeBottlenecks(stories, maxStorySize),
  ];
}

/** Attaches ingested mitigations to their bottlenecks by id; a mitigation with no match is ignored here. */
export function attachMitigations(bottlenecks: Bottleneck[], mitigationsById: Record<string, string>): Bottleneck[] {
  return bottlenecks.map((bottleneck) => ({
    ...bottleneck,
    mitigation: mitigationsById[bottleneck.id] ?? bottleneck.mitigation,
  }));
}
