// piDeliveryMonitorData.ts — Pure adapters that turn a written delivery plan + fetched live Jira rows into
// the snapshots piPlanMonitor.computeMonitor consumes (spec 032, US5). Kept pure and separate from the panel
// so the derivation is unit-testable and deterministic. Stories are keyed by summary so a monitor run can
// match the in-memory plan against the current Jira state without a tempId→realKey mapping.

import type { DeliveryPlan } from './piDeliveryEngine.ts';
import type { LiveJiraSnapshot, WrittenPlanSnapshot } from './piPlanMonitor.ts';
import type { PiPlanningFactSheet } from './piPlanTypes.ts';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
/** Jira status-category key for an in-progress issue (blue=new, yellow=indeterminate, green=done). */
const IN_PROGRESS_CATEGORY = 'indeterminate';
const DONE_CATEGORY = 'done';
/** The SL-test sub-task's title prefix, so the monitor can find it among a Story's children. */
const SL_SUBTASK_PREFIX = '[sl]';
const SPRINT_NAME_PATTERN = /name=([^,\]]+)/;

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

// ── Precise sub-task + sprint-field reads (replace the earlier Story-state approximations) ─────────────

/** Whole days between an ISO timestamp and `nowIso`, floored at zero. */
function daysBetween(fromIso: string, nowIso: string): number {
  const from = Date.parse(fromIso.slice(0, 10) + 'T00:00:00Z');
  const now = Date.parse(nowIso.slice(0, 10) + 'T00:00:00Z');
  return Number.isNaN(from) || Number.isNaN(now) ? 0 : Math.max(0, Math.floor((now - from) / MILLISECONDS_PER_DAY));
}

/** One of a Story's sub-tasks, normalized from Jira for the monitor. */
export interface SubtaskSignalInput {
  summary: string;
  /** The sub-task's status-category key ('new' | 'indeterminate' | 'done'). */
  statusCategoryKey: string;
  /** When the sub-task last changed (a proxy for time-in-status). */
  updatedIso: string;
}

/**
 * Derives a Story's precise monitor signals from its sub-tasks: the greatest age of any IN-PROGRESS sub-task
 * (days since it last changed), and whether the SL-test sub-task is still queued (present and not done). A
 * Story with no in-progress sub-tasks ages 0; one with no SL sub-task, or a done SL sub-task, is not queued.
 */
export function deriveSubtaskSignals(
  subtasks: SubtaskSignalInput[],
  nowIso: string,
): { agingDays: number; isSlQueued: boolean } {
  const agingDays = subtasks
    .filter((subtask) => subtask.statusCategoryKey === IN_PROGRESS_CATEGORY)
    .reduce((max, subtask) => Math.max(max, daysBetween(subtask.updatedIso, nowIso)), 0);
  const slSubtask = subtasks.find((subtask) => subtask.summary.trim().toLowerCase().startsWith(SL_SUBTASK_PREFIX));
  const isSlQueued = slSubtask !== undefined && slSubtask.statusCategoryKey !== DONE_CATEGORY;
  return { agingDays, isSlQueued };
}

/**
 * Extracts the newest sprint's name from Jira's raw sprint custom-field value — either the legacy greenhopper
 * string (`...[state=ACTIVE,name=26.4.2,...]`) or a modern `{ name }` object — mirroring the Hygiene view's
 * proven parser. Returns null when no sprint is present (the caller falls back to the planned sprint).
 */
export function parseSprintName(rawSprintValue: unknown): string | null {
  const sprintEntries = Array.isArray(rawSprintValue) ? rawSprintValue : [rawSprintValue];
  const newestEntry = sprintEntries[sprintEntries.length - 1];
  if (typeof newestEntry === 'string') {
    return newestEntry.match(SPRINT_NAME_PATTERN)?.[1]?.trim() ?? null;
  }
  if (newestEntry && typeof newestEntry === 'object') {
    return (newestEntry as { name?: string }).name?.trim() || null;
  }
  return null;
}
