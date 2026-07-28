// piPlanMonitor.ts — Turns the written plan + live Jira state into on-track signals and explicit replan
// triggers (spec 032, US5, contract monitoring-signals.md). This is what lets the team MONITOR adherence
// instead of re-planning: deterministic signals against the plan, and named thresholds that say when
// monitoring must escalate to a re-plan. Pure; the clock is injected; no AI.

import type { MonitorResult, MonitorSignal, ReplanTrigger } from './piPlanTypes.ts';

/** A sub-task In Progress longer than this many working days is "aging" (flow target). */
const SUBTASK_AGING_TARGET_DAYS = 5;
/** An in-flight issue with no GitHub-intake activity for longer than this is "stale" (freshness target). */
const FRESHNESS_TARGET_DAYS = 2;
/** A sprint is on-track for commit-vs-complete when it completes at least this fraction of what it committed. */
const COMMIT_COMPLETE_TARGET_RATIO = 0.8;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/** The written plan we monitor against (only what the signals need). */
export interface WrittenPlanSnapshot {
  sprints: { name: string; plannedPoints: number; slCapacity: number }[];
  stories: { key: string; plannedSprint: string }[];
}

/** The current Jira state (read by the caller). */
export interface LiveJiraSnapshot {
  sprints: { name: string; completedPoints: number; slQueueDepth: number; committedStories: number; completedStories: number }[];
  /** Greatest days a sub-task has sat In Progress. */
  maxSubtaskAgingDays: number;
  /** Last GitHub-intake activity per in-flight story, ISO — for the freshness signal. */
  lastActivityByStory: Record<string, string>;
  /** The sprint each story actually landed in (for slip detection). */
  actualSprintByStory: Record<string, string>;
}

/** Days between two ISO dates (whole days, floor). */
function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso.slice(0, 10) + 'T00:00:00Z').getTime();
  const to = new Date(toIso.slice(0, 10) + 'T00:00:00Z').getTime();
  return Math.floor((to - from) / MILLISECONDS_PER_DAY);
}

/** Burn-up per sprint: completed vs planned-to-date (cumulative). On-track when completed ≥ planned-to-date. */
function burnUpSignals(plan: WrittenPlanSnapshot, live: LiveJiraSnapshot): MonitorSignal[] {
  let plannedToDate = 0;
  let completedToDate = 0;
  return plan.sprints.map((sprint) => {
    plannedToDate += sprint.plannedPoints;
    const liveSprint = live.sprints.find((candidate) => candidate.name === sprint.name);
    completedToDate += liveSprint?.completedPoints ?? 0;
    return {
      kind: 'burnUp', sprintName: sprint.name, value: completedToDate, target: plannedToDate,
      isOnTrack: completedToDate >= plannedToDate,
      detail: `${completedToDate} completed vs ${plannedToDate} planned through ${sprint.name}`,
    };
  });
}

/** SL-queue depth per sprint vs SL capacity. On-track when depth ≤ capacity. */
function slQueueSignals(plan: WrittenPlanSnapshot, live: LiveJiraSnapshot): MonitorSignal[] {
  return plan.sprints.map((sprint) => {
    const depth = live.sprints.find((candidate) => candidate.name === sprint.name)?.slQueueDepth ?? 0;
    return {
      kind: 'slQueueDepth', sprintName: sprint.name, value: depth, target: sprint.slCapacity,
      isOnTrack: depth <= sprint.slCapacity, detail: `${depth} SL items queued vs capacity ${sprint.slCapacity} in ${sprint.name}`,
    };
  });
}

/** Commit-vs-complete per sprint. On-track when completed ≥ committed × target ratio. */
function commitVsCompleteSignals(live: LiveJiraSnapshot): MonitorSignal[] {
  return live.sprints.map((sprint) => {
    const target = sprint.committedStories * COMMIT_COMPLETE_TARGET_RATIO;
    return {
      kind: 'commitVsComplete', sprintName: sprint.name, value: sprint.completedStories, target,
      isOnTrack: sprint.completedStories >= target,
      detail: `${sprint.completedStories} of ${sprint.committedStories} committed stories completed in ${sprint.name}`,
    };
  });
}

/** Sub-task aging + freshness are single roll-up signals across all in-flight work. */
function healthSignals(live: LiveJiraSnapshot, nowIso: string): MonitorSignal[] {
  const staleDays = Object.values(live.lastActivityByStory)
    .map((activityIso) => daysBetween(activityIso, nowIso))
    .reduce((max, days) => Math.max(max, days), 0);
  return [
    { kind: 'subtaskAging', sprintName: null, value: live.maxSubtaskAgingDays, target: SUBTASK_AGING_TARGET_DAYS,
      isOnTrack: live.maxSubtaskAgingDays <= SUBTASK_AGING_TARGET_DAYS,
      detail: `Oldest In-Progress sub-task: ${live.maxSubtaskAgingDays} working days` },
    { kind: 'freshness', sprintName: null, value: staleDays, target: FRESHNESS_TARGET_DAYS,
      isOnTrack: staleDays <= FRESHNESS_TARGET_DAYS,
      detail: `Least-fresh in-flight story: ${staleDays} days since GitHub activity` },
  ];
}

/** A Story raises a slip trigger when its actual sprint is later than its planned sprint. */
function slipTriggers(plan: WrittenPlanSnapshot, live: LiveJiraSnapshot): ReplanTrigger[] {
  const order = new Map(plan.sprints.map((sprint, index) => [sprint.name, index]));
  return plan.stories.flatMap((story) => {
    const actualSprint = live.actualSprintByStory[story.key];
    if (actualSprint === undefined) {
      return [];
    }
    const plannedOrder = order.get(story.plannedSprint) ?? -1;
    const actualOrder = order.get(actualSprint) ?? -1;
    if (actualOrder > plannedOrder) {
      return [{ kind: 'storySlipped' as const, subjectKey: story.key,
        statement: `${story.key} slipped from ${story.plannedSprint} to ${actualSprint}.` }];
    }
    return [];
  });
}

/** The SL-queue trigger fires when depth exceeds capacity in two consecutive sprints. */
function slQueueTrigger(plan: WrittenPlanSnapshot, live: LiveJiraSnapshot): ReplanTrigger[] {
  const overCapacity = plan.sprints.map((sprint) => {
    const depth = live.sprints.find((candidate) => candidate.name === sprint.name)?.slQueueDepth ?? 0;
    return depth > sprint.slCapacity;
  });
  for (let index = 1; index < overCapacity.length; index += 1) {
    if (overCapacity[index] && overCapacity[index - 1]) {
      return [{ kind: 'slQueueOverTwoSprints', subjectKey: null,
        statement: `SL-test queue exceeded capacity in ${plan.sprints[index - 1].name} and ${plan.sprints[index].name} — re-plan.` }];
    }
  }
  return [];
}

/**
 * Computes the monitoring result against the written plan: the five on-track signals plus the explicit
 * replan triggers. Everything is derived from the plan snapshot without re-deriving the plan (SC-008).
 */
export function computeMonitor(plan: WrittenPlanSnapshot, live: LiveJiraSnapshot, nowIso: string): MonitorResult {
  return {
    signals: [
      ...burnUpSignals(plan, live),
      ...slQueueSignals(plan, live),
      ...commitVsCompleteSignals(live),
      ...healthSignals(live, nowIso),
    ],
    triggers: [...slipTriggers(plan, live), ...slQueueTrigger(plan, live)],
  };
}
