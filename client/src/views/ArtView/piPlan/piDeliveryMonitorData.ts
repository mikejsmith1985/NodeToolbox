// piDeliveryMonitorData.ts — Pure adapters that turn a written delivery plan + fetched live Jira rows into
// the snapshots piPlanMonitor.computeMonitor consumes (spec 032, US5). Kept pure and separate from the panel
// so the derivation is unit-testable and deterministic. Stories are keyed by summary so a monitor run can
// match the in-memory plan against the current Jira state without a tempId→realKey mapping.

import type { DeliveryPlan } from './piDeliveryEngine.ts';
import type { LiveJiraSnapshot, WrittenPlanSnapshot } from './piPlanMonitor.ts';
import type { PiPlanningFactSheet } from './piPlanTypes.ts';

/** One live Jira row per Story the monitor observed (already normalized from the Jira read by the panel). */
export interface LiveStoryRow {
  /** The Story summary — the key we match against the written plan. */
  storyKey: string;
  /** The sprint the Story actually landed in. */
  sprintName: string;
  /** The Story's points (for burn-up). */
  points: number;
  /** True when the Story has reached a done-category status. */
  isDone: boolean;
  /** True when the Story's SL-test sub-task is not yet done (it is queued/awaiting SL). */
  isSlQueued: boolean;
  /** Greatest days any of the Story's sub-tasks has sat In Progress. */
  subtaskAgingDays: number;
  /** ISO timestamp of the last GitHub-intake activity comment on the Story (freshness). */
  lastActivityIso: string;
}

/** Total per-sprint SL-test capacity = the sum of the SL-capable people's per-sprint points. */
function slCapacityPerSprint(factSheet: PiPlanningFactSheet): number {
  return factSheet.people
    .filter((person) => person.roles.includes('internalTest'))
    .reduce((sum, person) => sum + person.pointsPerSprint, 0);
}

/**
 * Derives the written-plan snapshot from the in-memory delivery plan: per-sprint planned points (summed
 * from the Stories placed in each sprint) and SL capacity, plus each Story's planned sprint. Deterministic,
 * no I/O — this is the baseline the monitor measures adherence against.
 */
export function planToWrittenSnapshot(plan: DeliveryPlan, factSheet: PiPlanningFactSheet): WrittenPlanSnapshot {
  const slCapacity = slCapacityPerSprint(factSheet);
  const plannedPointsByeSprint = new Map<string, number>();
  plan.stories.forEach((story) => {
    plannedPointsByeSprint.set(story.sprintName, (plannedPointsByeSprint.get(story.sprintName) ?? 0) + story.sizePoints);
  });
  const sprints = factSheet.sprints.map((sprint) => ({
    name: sprint.name,
    plannedPoints: plannedPointsByeSprint.get(sprint.name) ?? 0,
    slCapacity,
  }));
  const stories = plan.stories.map((story) => ({ key: story.summary, plannedSprint: story.sprintName }));
  return { sprints, stories };
}

/**
 * Aggregates the fetched live Story rows into the monitor's live snapshot, using the written snapshot for
 * the committed-story counts per sprint. Sprints with no live rows report zeros (honestly on-track-by-default
 * only when nothing was planned there).
 */
export function summarizeLiveRows(rows: LiveStoryRow[], written: WrittenPlanSnapshot): LiveJiraSnapshot {
  const committedBySprint = new Map<string, number>();
  written.stories.forEach((story) => {
    committedBySprint.set(story.plannedSprint, (committedBySprint.get(story.plannedSprint) ?? 0) + 1);
  });

  const sprints = written.sprints.map((sprint) => {
    const sprintRows = rows.filter((row) => row.sprintName === sprint.name);
    return {
      name: sprint.name,
      completedPoints: sprintRows.filter((row) => row.isDone).reduce((sum, row) => sum + row.points, 0),
      slQueueDepth: sprintRows.filter((row) => row.isSlQueued).length,
      committedStories: committedBySprint.get(sprint.name) ?? 0,
      completedStories: sprintRows.filter((row) => row.isDone).length,
    };
  });

  const lastActivityByStory: Record<string, string> = {};
  const actualSprintByStory: Record<string, string> = {};
  let maxSubtaskAgingDays = 0;
  rows.forEach((row) => {
    lastActivityByStory[row.storyKey] = row.lastActivityIso;
    actualSprintByStory[row.storyKey] = row.sprintName;
    maxSubtaskAgingDays = Math.max(maxSubtaskAgingDays, row.subtaskAgingDays);
  });

  return { sprints, maxSubtaskAgingDays, lastActivityByStory, actualSprintByStory };
}
