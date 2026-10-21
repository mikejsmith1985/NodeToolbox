// createdChanges.ts — The changes the Wizard creates early ("create first"): read back their tasks, name them for the AI, and save the finished work to each.
//
// Creating the changes before the writing lets the text quote real CHG and CTASK numbers (owner's decision, GH #468).
// The finished work is then written to each change with the very payload createChg built it with
// (buildEnvironmentChangePayload), and each task card to the task ServiceNow made for it (updateChangeTaskRecord) —
// Toolbox's own writers, so nothing here decides what a field holds.

import { snowFetch } from '../../services/snowApi.ts';
import type { ChangeTaskDefaults } from '../../views/SnowHub/ctaskParentDefaults.ts';
import {
  buildEnvironmentChangePayload, fetchChangeTaskDefaults, updateChangeTaskRecord,
  type CtaskTemplate, type EnvironmentKey, type EnvironmentValueByKey,
} from '../../views/SnowHub/hooks/useCrgState.ts';
import type { CrgDraftState } from './changeDraft.ts';
import type { CreatedChangeSummary } from './createOutcome.ts';
import { filterStagedCtasksForEnvironment, type CtaskEnvironmentPlan } from './ctaskEnvironmentPlan.ts';
import { fetchChangeForModify } from './modifyLoad.ts';

/** One task ServiceNow holds on a created change. */
export interface CreatedTaskRecord {
  sysId: string;
  number: string;
  shortDescription: string;
}

/** Each created change's tasks, by change number. */
export type CreatedTasksByChange = Record<string, CreatedTaskRecord[]>;

/** Who a task is assigned to in ServiceNow, as ids and names. */
export interface TaskAssignment {
  assignmentGroup: { sysId: string; displayName: string };
  assignedTo: { sysId: string; displayName: string };
}

/** The ServiceNow reads and writes a save goes through; replaceable in tests. */
export interface CreatedChangeWriters {
  readTaskAssignment: (taskSysId: string) => Promise<TaskAssignment>;
  patchTaskAssignment: (taskSysId: string, assignment: Partial<Record<'assignment_group' | 'assigned_to', string>>) => Promise<void>;
  resolveChangeSysId: (changeNumber: string) => Promise<string>;
  patchChange: (changeSysId: string, payload: Record<string, unknown>) => Promise<void>;
  listTasks: (changeNumber: string) => Promise<CreatedTaskRecord[]>;
  readChangeDefaults: (changeSysId: string) => Promise<ChangeTaskDefaults>;
  updateTask: (taskSysId: string, changeSysId: string, task: CtaskTemplate, changeDefaults: ChangeTaskDefaults) => Promise<void>;
}

const TASK_FIELDS = 'sys_id,number,short_description';

/** A field's plain value, whether ServiceNow sent it bare or as { value, display_value }. */
function readFieldText(field: unknown): string {
  if (typeof field === 'object' && field !== null) {
    const fieldObject = field as { value?: unknown; display_value?: unknown };
    return String(fieldObject.display_value ?? fieldObject.value ?? '');
  }
  return field === undefined || field === null ? '' : String(field);
}

/** The tasks on one change, oldest first (the order createChg made them in). */
export async function listCreatedChangeTasks(changeNumber: string): Promise<CreatedTaskRecord[]> {
  const taskQuery = encodeURIComponent(`change_request.number=${changeNumber}^ORDERBYnumber`);
  const reply = await snowFetch<{ result?: unknown }>(`/api/now/table/change_task?sysparm_query=${taskQuery}&sysparm_fields=${TASK_FIELDS}`);
  const taskRows = Array.isArray(reply?.result) ? reply.result as Array<Record<string, unknown>> : [];
  return taskRows.map((taskRow) => ({
    sysId: readFieldText(taskRow.sys_id), number: readFieldText(taskRow.number), shortDescription: readFieldText(taskRow.short_description),
  }));
}

/** One task's assignment as ServiceNow holds it now. */
async function readTaskAssignment(taskSysId: string): Promise<TaskAssignment> {
  const reply = await snowFetch<{ result?: Record<string, unknown> }>(
    `/api/now/table/change_task/${encodeURIComponent(taskSysId)}?sysparm_fields=assignment_group,assigned_to&sysparm_display_value=all`,
  );
  const taskRecord = reply?.result ?? {};
  return { assignmentGroup: readReference(taskRecord.assignment_group), assignedTo: readReference(taskRecord.assigned_to) };
}

/** A reference field's id and name, whatever shape ServiceNow sent. */
function readReference(field: unknown): { sysId: string; displayName: string } {
  if (typeof field === 'object' && field !== null) {
    const fieldObject = field as { value?: unknown; display_value?: unknown };
    return { sysId: String(fieldObject.value ?? ''), displayName: String(fieldObject.display_value ?? '') };
  }
  return { sysId: field === undefined || field === null ? '' : String(field), displayName: '' };
}

const DEFAULT_WRITERS: CreatedChangeWriters = {
  readTaskAssignment,
  patchTaskAssignment: async (taskSysId, assignment) => {
    await snowFetch(`/api/now/table/change_task/${encodeURIComponent(taskSysId)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(assignment),
    });
  },
  resolveChangeSysId: async (changeNumber) => (await fetchChangeForModify(changeNumber)).changeSysId,
  patchChange: async (changeSysId, payload) => {
    await snowFetch(`/api/now/table/change_request/${encodeURIComponent(changeSysId)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
  },
  listTasks: listCreatedChangeTasks,
  readChangeDefaults: fetchChangeTaskDefaults,
  updateTask: updateChangeTaskRecord,
};

/** Which cards were paired with a task, and which found none (they are left alone, never guessed). */
export interface TaskCardMatches {
  matches: Array<{ card: CtaskTemplate; taskRecord: CreatedTaskRecord }>;
  unmatchedCards: CtaskTemplate[];
}

/** The first unused task that passes the test, taken out of the pool. */
function takeRecord(unusedRecords: CreatedTaskRecord[], isMatch: (taskRecord: CreatedTaskRecord) => boolean): CreatedTaskRecord | null {
  const recordIndex = unusedRecords.findIndex(isMatch);
  return recordIndex === -1 ? null : unusedRecords.splice(recordIndex, 1)[0];
}

/**
 * Pairs each task card with ITS ServiceNow task: by CTASK number (a card rebuilt from a created change is named by its
 * task's number), else by the exact short description (create wrote each card's own title). A card matching neither
 * is left out — pairing by position could write one environment's task over another's, dates included.
 */
export function matchTasksToCards(cards: readonly CtaskTemplate[], taskRecords: readonly CreatedTaskRecord[]): TaskCardMatches {
  const unusedRecords = [...taskRecords];
  const result: TaskCardMatches = { matches: [], unmatchedCards: [] };
  for (const card of cards) {
    const cardTitle = (card.shortDescription ?? '').trim();
    const taskRecord = takeRecord(unusedRecords, (record) => record.number !== '' && record.number === card.name.trim())
      ?? takeRecord(unusedRecords, (record) => cardTitle !== '' && record.shortDescription.trim() === cardTitle);
    if (taskRecord) result.matches.push({ card, taskRecord });
    else result.unmatchedCards.push(card);
  }
  return result;
}

/**
 * The tasks on a change that are not one of the user's cards — usually ones ServiceNow made by itself, which sit on
 * the change's own group and owner. Named, so they are never mistaken for the user's own.
 */
function describeExtraTasks(changeNumber: string, taskRecords: readonly CreatedTaskRecord[], matchedSysIds: readonly string[]): string[] {
  const extraTasks = taskRecords.filter((taskRecord) => !matchedSysIds.includes(taskRecord.sysId));
  if (extraTasks.length === 0) return [];
  const extraText = extraTasks.map((taskRecord) => `${taskRecord.number} (${taskRecord.shortDescription || 'no title'})`).join(', ');
  return [`Also on ${changeNumber}, but not one of your task cards (ServiceNow made ${extraTasks.length === 1 ? 'it' : 'them'}; left as is): ${extraText}.`];
}

/** "REL change CHG0012345 — tasks: CTASK001 (Deploy), CTASK002 (Checkout)", one line per created change. */
export function describeCreatedChangesForPrompt(createdChanges: readonly CreatedChangeSummary[], tasksByChange: CreatedTasksByChange | undefined): string[] {
  return createdChanges.map((createdChange) => {
    const taskRecords = tasksByChange?.[createdChange.changeNumber] ?? [];
    const taskText = taskRecords.length > 0
      ? taskRecords.map((taskRecord) => `${taskRecord.number} (${taskRecord.shortDescription || 'no title'})`).join(', ') : 'none';
    return `${createdChange.environmentLabel ?? 'Change'} change ${createdChange.changeNumber} — tasks: ${taskText}`;
  });
}

/** The assignment fields a card asks for that ServiceNow does not hold (only fields the card actually sets). */
function listAssignmentDifferences(card: CtaskTemplate, heldAssignment: TaskAssignment): Partial<Record<'assignment_group' | 'assigned_to', string>> {
  const differences: Partial<Record<'assignment_group' | 'assigned_to', string>> = {};
  if (card.assignmentGroup.sysId && card.assignmentGroup.sysId !== heldAssignment.assignmentGroup.sysId) differences.assignment_group = card.assignmentGroup.sysId;
  if (card.assignedTo.sysId && card.assignedTo.sysId !== heldAssignment.assignedTo.sysId) differences.assigned_to = card.assignedTo.sysId;
  return differences;
}

/**
 * Reads a written task back and makes its assignment the card's: the group and person the user chose. ServiceNow can
 * put a task back on the change's own group and owner (its default, or a rule on the instance) — that was reported as
 * "my tasks were assigned to me and my group". Re-applied once; if ServiceNow still overrides it, the note says so.
 */
async function enforceTaskAssignment(card: CtaskTemplate, taskRecord: CreatedTaskRecord, writers: CreatedChangeWriters): Promise<string | null> {
  const differences = listAssignmentDifferences(card, await writers.readTaskAssignment(taskRecord.sysId));
  if (Object.keys(differences).length === 0) return null;
  await writers.patchTaskAssignment(taskRecord.sysId, differences);
  const heldAfterRetry = await writers.readTaskAssignment(taskRecord.sysId);
  if (Object.keys(listAssignmentDifferences(card, heldAfterRetry)).length === 0) return null;
  const heldText = [heldAfterRetry.assignmentGroup.displayName, heldAfterRetry.assignedTo.displayName].filter(Boolean).join(' / ') || 'nobody';
  const wantedText = [card.assignmentGroup.displayName, card.assignedTo.displayName].filter(Boolean).join(' / ');
  return `${taskRecord.number}: ServiceNow kept it on ${heldText} instead of ${wantedText} — a rule in ServiceNow overrides the assignment, so set it there by hand.`;
}

/** What saving one created change needs. */
export interface SaveCreatedChangeInput {
  draft: CrgDraftState;
  createdChange: CreatedChangeSummary;
  environmentValueByKey: EnvironmentValueByKey;
  ctaskEnvironmentPlan: CtaskEnvironmentPlan;
}

/**
 * Writes the finished change to one created change (its own environment's values), then each of its task cards to
 * the task made for it. Returns a plain summary; a failed write throws with ServiceNow's reason.
 */
export async function saveCreatedChange(input: SaveCreatedChangeInput, writers: CreatedChangeWriters = DEFAULT_WRITERS): Promise<string> {
  const { createdChange, draft } = input;
  const environmentLabel = createdChange.environmentLabel;
  if (!environmentLabel) throw new Error(`${createdChange.changeNumber} has no environment to save.`);
  const changeSysId = await writers.resolveChangeSysId(createdChange.changeNumber);
  await writers.patchChange(changeSysId, buildEnvironmentChangePayload(draft, environmentLabel.toLowerCase() as EnvironmentKey, input.environmentValueByKey));
  const cards = filterStagedCtasksForEnvironment([...draft.changeTasks], input.ctaskEnvironmentPlan, environmentLabel);
  const taskRecords = await writers.listTasks(createdChange.changeNumber);
  const { matches, unmatchedCards } = matchTasksToCards(cards, taskRecords);
  const assignmentNotes: string[] = [];
  if (matches.length > 0) {
    const changeDefaults = await writers.readChangeDefaults(changeSysId);
    for (const { card, taskRecord } of matches) {
      await writers.updateTask(taskRecord.sysId, changeSysId, card, changeDefaults);
      const assignmentNote = await enforceTaskAssignment(card, taskRecord, writers);
      if (assignmentNote) assignmentNotes.push(assignmentNote);
    }
  }
  return [
    `${createdChange.changeNumber} saved, with ${matches.length} task${matches.length === 1 ? '' : 's'} updated and checked.`,
    unmatchedCards.length > 0 ? `Not on it, so left alone: ${unmatchedCards.map((card) => `“${card.shortDescription || card.name}”`).join(', ')}.` : '',
    ...describeExtraTasks(createdChange.changeNumber, taskRecords, matches.map(({ taskRecord }) => taskRecord.sysId)),
    ...assignmentNotes,
  ].filter((notePart) => notePart !== '').join(' ');
}
