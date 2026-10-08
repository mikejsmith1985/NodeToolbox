// ctaskReviewRecord.ts — Reads a change task the way the CHG risk check judges it: type, CI and backout plan (GH #395).
//
// The Release Manager holds every CTASK to two rules: its configuration item must be the change's, and an
// implementation task must carry a detailed backout plan. ServiceNow has no standard backout field on a
// change task — an instance that wants one adds its own (u_backout_plan and the like) — so the field is found
// by name on the record itself, and where none exists the plan lives in a marked section of the description.

import { extractStringValue, extractSnowReference, type SnowReference } from '../hooks/useCrgState.ts';

/** One change task as the risk check reads it. */
export interface ReviewedCtask {
  sysId: string;
  number: string;
  shortDescription: string;
  description: string;
  /** The task type as ServiceNow shows it ("Implementation"), or '' when the instance has no type field. */
  typeLabel: string;
  isImplementation: boolean;
  configItem: SnowReference;
  /** Who the task is assigned to, and their group — the people who deploy, validate or back out the change. */
  assignedTo: SnowReference;
  assignmentGroup: SnowReference;
  backoutPlan: string;
  /** The instance's own backout field, or null when the plan is kept in the description. */
  backoutFieldName: string | null;
}

// The standard change-task type field; absent on instances that removed it.
const TASK_TYPE_FIELD_NAME = 'change_task_type';
// A field whose name says "backout" but holds a timing or a yes/no rather than the plan itself.
const NON_PLAN_BACKOUT_FIELD_PATTERN = /time|duration|minute|hour|date|estimate|can_|_be_|tested/i;
// Read from the name when there is no type field: a task that deploys or implements is an implementation task.
const IMPLEMENTATION_NAME_PATTERN = /implement|deploy|release|install|cut ?over/i;
const BACKOUT_SECTION_START = '--- Backout plan ---';
const BACKOUT_SECTION_END = '--- End backout plan ---';
const BACKOUT_SECTION_PATTERN = new RegExp(`\\n*${BACKOUT_SECTION_START}\\n?([\\s\\S]*?)\\n?${BACKOUT_SECTION_END}`);

/**
 * The record field that holds a task's backout plan: a field named for backout, preferring one that says
 * "plan", and never a backout timing. Null when the instance keeps no such field on a change task.
 */
export function findBackoutFieldName(record: Readonly<Record<string, unknown>>): string | null {
  const backoutFieldNames = Object.keys(record)
    .filter((fieldName) => /backout/i.test(fieldName) && !NON_PLAN_BACKOUT_FIELD_PATTERN.test(fieldName));
  return backoutFieldNames.find((fieldName) => /plan/i.test(fieldName)) ?? backoutFieldNames[0] ?? null;
}

/** The backout plan kept in a description's marked section, or '' when there is none. */
export function readBackoutSectionFromDescription(description: string): string {
  return BACKOUT_SECTION_PATTERN.exec(description)?.[1].trim() ?? '';
}

/**
 * The description with its backout section set to this plan — replacing an earlier one rather than stacking a
 * second, so writing a fix twice leaves one plan. Everything else in the description is kept as it was.
 */
export function upsertBackoutSection(description: string, backoutPlan: string): string {
  const descriptionWithoutSection = description.replace(BACKOUT_SECTION_PATTERN, '').trimEnd();
  const backoutSection = `${BACKOUT_SECTION_START}\n${backoutPlan.trim()}\n${BACKOUT_SECTION_END}`;
  return descriptionWithoutSection === '' ? backoutSection : `${descriptionWithoutSection}\n\n${backoutSection}`;
}

/** True when the task is an implementation task, by its type or — with no type field — by its name. */
function readIsImplementation(record: Readonly<Record<string, unknown>>, shortDescription: string): boolean {
  if (!(TASK_TYPE_FIELD_NAME in record)) {
    return IMPLEMENTATION_NAME_PATTERN.test(shortDescription);
  }
  const typeField = record[TASK_TYPE_FIELD_NAME];
  const storedType = typeof typeField === 'object' && typeField !== null
    ? String((typeField as { value?: unknown }).value ?? '')
    : String(typeField ?? '');
  return /implement/i.test(storedType) || /implement/i.test(extractStringValue(typeField));
}

/** A change_task record (read with sysparm_display_value=all) as the risk check reads it. */
export function readReviewedCtask(record: Readonly<Record<string, unknown>>): ReviewedCtask {
  const shortDescription = extractStringValue(record.short_description);
  const description = extractStringValue(record.description);
  const backoutFieldName = findBackoutFieldName(record);
  return {
    sysId: extractSnowReference(record.sys_id).sysId || extractStringValue(record.sys_id),
    number: extractStringValue(record.number),
    shortDescription,
    description,
    typeLabel: TASK_TYPE_FIELD_NAME in record ? extractStringValue(record[TASK_TYPE_FIELD_NAME]) : '',
    isImplementation: readIsImplementation(record, shortDescription),
    configItem: extractSnowReference(record.cmdb_ci),
    assignedTo: extractSnowReference(record.assigned_to),
    assignmentGroup: extractSnowReference(record.assignment_group),
    backoutPlan: backoutFieldName
      ? extractStringValue(record[backoutFieldName]).trim()
      : readBackoutSectionFromDescription(description),
    backoutFieldName,
  };
}
