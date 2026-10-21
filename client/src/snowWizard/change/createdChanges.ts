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

/** The ServiceNow reads and writes a save goes through; replaceable in tests. */
export interface CreatedChangeWriters {
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

const DEFAULT_WRITERS: CreatedChangeWriters = {
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

/**
 * Pairs each task card with the ServiceNow task made for it: first by short description, then — for any left — in
 * order, since createChg overwrites ServiceNow's own tasks in order and adds the rest after them.
 */
export function matchTasksToCards(cards: readonly CtaskTemplate[], taskRecords: readonly CreatedTaskRecord[]): Array<{ card: CtaskTemplate; taskRecord: CreatedTaskRecord }> {
  const unusedRecords = [...taskRecords];
  const unmatchedCards: CtaskTemplate[] = [];
  const matches: Array<{ card: CtaskTemplate; taskRecord: CreatedTaskRecord }> = [];
  for (const card of cards) {
    const recordIndex = unusedRecords.findIndex((taskRecord) => taskRecord.shortDescription.trim() !== '' && taskRecord.shortDescription.trim() === (card.shortDescription ?? '').trim());
    if (recordIndex === -1) unmatchedCards.push(card);
    else matches.push({ card, taskRecord: unusedRecords.splice(recordIndex, 1)[0] });
  }
  unmatchedCards.forEach((card, cardIndex) => { if (unusedRecords[cardIndex]) matches.push({ card, taskRecord: unusedRecords[cardIndex] }); });
  return matches;
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
  const matches = matchTasksToCards(cards, await writers.listTasks(createdChange.changeNumber));
  if (matches.length > 0) {
    const changeDefaults = await writers.readChangeDefaults(changeSysId);
    for (const { card, taskRecord } of matches) await writers.updateTask(taskRecord.sysId, changeSysId, card, changeDefaults);
  }
  return `${createdChange.changeNumber} saved, with ${matches.length} task${matches.length === 1 ? '' : 's'} updated.`;
}
