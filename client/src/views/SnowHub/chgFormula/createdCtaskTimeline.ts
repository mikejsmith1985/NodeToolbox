// createdCtaskTimeline.ts — Plans a new change's CTASK timeline before it exists, and dates the tasks it gets.
//
// Create New CHG plans the order of operations before submitting, from the tasks the change will have: the staged
// ones plus the Implementation and Technical Checkout ServiceNow creates itself. Once the change exists, the plan
// is matched to the tasks it really got — by name, else by stage — and each is dated back to back from that
// environment's planned start. A change planned without AI Assist is still dated, from each task's own estimates.

import { readEstimatesFromText } from '../ctaskDurations.ts';
import type { ReviewedCtask } from './ctaskReviewRecord.ts';
import {
  parseCtaskTimelineReply,
  rankCtaskStage,
  scheduleCtaskTimeline,
  type CtaskTimelineEntry,
  type ScheduledCtask,
} from './ctaskTimeline.ts';

/** One step of the plan: the task's name and how long it takes, in the order the tasks run. */
export interface CtaskTimelinePlanStep {
  taskLabel: string;
  minutes: number;
}

/** A staged task as the plan reads it: its name and its instructions. */
export interface StagedTaskSummary {
  label: string;
  description: string;
}

// Placeholder numbers for tasks that do not exist yet, so the planning prompt and reply work as they do on Modify.
const PLANNED_TASK_NUMBER_BASE = 9_000_000;
const AUTO_IMPLEMENTATION_LABEL = 'Implementation (created by ServiceNow)';
const AUTO_TECHNICAL_CHECKOUT_LABEL = 'Technical Checkout (created by ServiceNow)';
// What makes a task an implementation task when it has no type yet.
const IMPLEMENTATION_LABEL_PATTERN = /implement|deploy|release|install|cut ?over/i;
// The form's date-time length: "YYYY-MM-DDTHH:mm".
const FORM_DATE_TIME_LENGTH = 16;

/** A task the change will have, shaped like a read CTASK so the Modify planning prompt can be reused. */
function buildPlannedTask(label: string, description: string, taskIndex: number): ReviewedCtask {
  return {
    sysId: '',
    number: `CTASK${PLANNED_TASK_NUMBER_BASE + taskIndex + 1}`,
    shortDescription: label,
    description,
    typeLabel: '',
    isImplementation: IMPLEMENTATION_LABEL_PATTERN.test(label),
    configItem: { sysId: '', displayName: '' },
    assignedTo: { sysId: '', displayName: '' },
    assignmentGroup: { sysId: '', displayName: '' },
    backoutPlan: '',
    backoutFieldName: null,
  };
}

/** The tasks the new change will have: ServiceNow's own two (when it creates them) and the staged ones. */
export function buildPlannedTasks(stagedTasks: readonly StagedTaskSummary[], hasAutoCreatedTasks: boolean): ReviewedCtask[] {
  const autoTasks: StagedTaskSummary[] = hasAutoCreatedTasks
    ? [{ label: AUTO_IMPLEMENTATION_LABEL, description: '' }, { label: AUTO_TECHNICAL_CHECKOUT_LABEL, description: '' }]
    : [];
  return [...autoTasks, ...stagedTasks].map((task, taskIndex) => buildPlannedTask(task.label, task.description, taskIndex));
}

/** The pasted reply as a plan by task name, in the order the assistant gave. */
export function readTimelinePlanFromReply(replyText: string, plannedTasks: readonly ReviewedCtask[]): CtaskTimelinePlanStep[] {
  return parseCtaskTimelineReply(replyText, plannedTasks).entries.map((entry) => ({
    taskLabel: plannedTasks.find((plannedTask) => plannedTask.number === entry.ctaskNumber)?.shortDescription ?? '',
    minutes: entry.minutes,
  }));
}

/** Lower-case letters and digits only, so names compare without punctuation or spacing. */
function normaliseLabel(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** A task's own estimated minutes: implementation plus validation, or 0 when it carries none. */
function readEstimatedMinutes(ctask: ReviewedCtask): number {
  const estimates = readEstimatesFromText(ctask.description);
  return Number(estimates.implementationMinutes || 0) + Number(estimates.validationMinutes || 0);
}

/** The created task a plan step is about: the one with its name, else the next one in its stage. */
function findCreatedTask(step: CtaskTimelinePlanStep, createdTasks: readonly ReviewedCtask[], usedNumbers: ReadonlySet<string>): ReviewedCtask | undefined {
  const unusedTasks = createdTasks.filter((createdTask) => !usedNumbers.has(createdTask.number));
  const stepStage = rankCtaskStage({ typeLabel: '', shortDescription: step.taskLabel, isImplementation: IMPLEMENTATION_LABEL_PATTERN.test(step.taskLabel) });
  return unusedTasks.find((createdTask) => normaliseLabel(createdTask.shortDescription) === normaliseLabel(step.taskLabel))
    ?? unusedTasks.find((createdTask) => rankCtaskStage(createdTask) === stepStage);
}

/**
 * The created tasks dated back to back from the window start: the plan's minutes for each task it covers, then any
 * other task by its own estimates. A task with neither is left undated rather than given an invented length.
 */
export function scheduleCreatedCtasks(
  createdTasks: readonly ReviewedCtask[],
  plan: readonly CtaskTimelinePlanStep[],
  windowStartUtc: string,
): ScheduledCtask[] {
  const usedNumbers = new Set<string>();
  const entries: CtaskTimelineEntry[] = [];
  for (const step of plan) {
    const createdTask = findCreatedTask(step, createdTasks, usedNumbers);
    if (createdTask) {
      usedNumbers.add(createdTask.number);
      entries.push({ ctaskNumber: createdTask.number.toUpperCase(), minutes: step.minutes });
    }
  }
  createdTasks
    .filter((createdTask) => !usedNumbers.has(createdTask.number) && readEstimatedMinutes(createdTask) > 0)
    .forEach((createdTask) => entries.push({ ctaskNumber: createdTask.number.toUpperCase(), minutes: readEstimatedMinutes(createdTask) }));
  return scheduleCtaskTimeline(entries, createdTasks, windowStartUtc);
}

/** The change builder's API date-time ("2026-10-10 05:00:00", UTC) as the form's ("2026-10-10T05:00"). */
export function toFormUtcFromApi(apiDateTime: string): string {
  return apiDateTime.trim() === '' ? '' : apiDateTime.trim().replace(' ', 'T').slice(0, FORM_DATE_TIME_LENGTH);
}
